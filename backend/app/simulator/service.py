"""Simulator: drives the synthetic products so you can watch the orchestrator work.

- inject a vehicle fault (telematics reading with a DTC)
- flag overdue preventive maintenance
- send a duplicate event (to show de-duplication)
- inject product failures (to show retries and compensation)
- background telemetry stream and PM scanner
"""
import asyncio
import random
from typing import Optional

from sqlalchemy import select

from app.core.clock import new_id, now
from app.core.config import settings
from app.core.database import SessionLocal, session_scope
from app.core.event_bus import bus
from app.core.logging import get_logger
from app.identity.service import identity
from app.models import Asset, FaultInjection, Tenant, TelemetryDevice, TelemetryReading, User, Workflow
from app.products.asset_mgmt import service as am
from app.products.common import product_session
from app.products.telematics import service as tl
from app.products.trip_mgmt import service as tm

log = get_logger("simulator")

async def no_show(tenant_id: str, run_id: Optional[str] = None, kind: str = "no_show", prefer: str = "any") -> dict:
    """Mark the next upcoming booked pickup on a run as a no-show (or late cancellation).

    prefer: any | standby (a run with a waiting standby rider that fits) | late (a run running behind)
    """
    from datetime import timedelta

    from app.models import Run, Trip, TripRequest

    if kind not in ("no_show", "late_cancel"):
        raise ValueError("kind must be no_show or late_cancel")
    t_now = now()
    async with SessionLocal() as s:
        q = select(Run).where(Run.tenant_id == tenant_id, Run.status.in_(["scheduled", "in_progress"]), Run.end_time > t_now)
        if run_id:
            q = q.where(Run.id == run_id)
        runs = (await s.execute(q.order_by(Run.start_time))).scalars().all()
        best = None
        for r in runs:
            trips = (await s.execute(select(Trip).where(Trip.run_id == r.id, Trip.status == "booked", Trip.pickup_time > t_now)
                                     .order_by(Trip.pickup_time))).scalars().all()
            if len(trips) < 3 and not run_id:
                continue
            for t in trips[:-1] if len(trips) > 1 else trips:
                if prefer == "late" and r.delay_minutes <= 10:
                    break
                if prefer == "standby":
                    fits = (await s.execute(select(TripRequest.id).where(
                        TripRequest.tenant_id == tenant_id, TripRequest.status == "waiting", TripRequest.route_name == r.route_name,
                        TripRequest.service_date == r.service_date, TripRequest.window_start < t.pickup_time + timedelta(minutes=28),
                        TripRequest.window_end > t.pickup_time - timedelta(minutes=10)).limit(1))).scalar_one_or_none()
                    if not fits or r.delay_minutes > 10:
                        continue
                best = (r, t)
                break
            if best:
                break
        if not best:
            raise ValueError("No upcoming booked pickup matches. Try another option, or reset the demo data to get a fresh day.")
        r, t = best
        trip_id, label = t.id, r.route_name
    async with product_session() as s:
        await tm.mark_no_show(s, tenant_id, trip_id, kind)
    return {"trip_id": trip_id, "run_id": r.id, "route": label, "kind": kind}


async def set_driver_compliance(tenant_id: str, driver_name: Optional[str], issue: str) -> dict:
    """Pick a driver (by name, or the first compliant rostered driver) and change their Vestige compliance."""
    from app.models import SafetyDriver
    from app.products.safety import service as sf

    async with SessionLocal() as s:
        q = select(SafetyDriver).where(SafetyDriver.tenant_id == tenant_id)
        if driver_name:
            q = q.where(SafetyDriver.name == driver_name)
        else:
            q = q.where(SafetyDriver.status == "compliant", SafetyDriver.medical_card_expires > now().date())
        d = (await s.execute(q.order_by(SafetyDriver.safety_id).limit(1))).scalar_one_or_none()
        if not d:
            raise ValueError("No matching driver in Vestige.")
        sid, name = d.safety_id, d.name
    async with product_session() as s:
        d = await sf.set_compliance(s, tenant_id, sid, issue=issue, by="Simulator")
        return {"driver": name, "safety_id": sid, **sf.compliance(d, now().date())}


FAULT_TARGETS = {
    "asset_mgmt.create_work_order": "Asset management rejects new work orders",
    "trip_mgmt.block_vehicle": "Trip management rejects pulling a vehicle",
    "trip_mgmt.assign_run": "Trip management rejects run reassignment",
    "rider_comms.send": "Rider comms cannot send notifications",
    "trip_mgmt.unblock_vehicle": "Trip management rejects returning a vehicle",
    "trip_mgmt.book_request": "Trip management rejects booking a standby rider",
    "safety.open_defect": "Vestige rejects recording a vehicle defect",
}


async def inject_fault(tenant_id: str, vehicle_label: str, fault_code: str) -> dict:
    async with SessionLocal() as s:
        vid = await identity.by_label(s, tenant_id, "vehicle", vehicle_label)
        if not vid:
            raise ValueError(f"Vehicle {vehicle_label} not found")
        device = await identity.to_external(s, tenant_id, vid, "telematics")
        last = (await s.execute(select(TelemetryReading).where(TelemetryReading.device_id == device)
                                .order_by(TelemetryReading.ts.desc()).limit(1))).scalar_one_or_none()
    async with product_session() as s:
        rec = await tl.ingest_reading(s, tenant_id, tl.synthetic_reading(device, last.odometer if last else 100_000, fault_code))
    return {"vehicle": vehicle_label, "device_id": device, "fault_code": fault_code, "reading_id": rec.id}


async def flag_pm(tenant_id: str, vehicle_label: str, miles_over: Optional[int] = None) -> dict:
    async with product_session() as s:
        vid = await identity.by_label(s, tenant_id, "vehicle", vehicle_label)
        if not vid:
            raise ValueError(f"Vehicle {vehicle_label} not found")
        asset_no = await identity.to_external(s, tenant_id, vid, "asset_mgmt")
        a = await s.get(Asset, asset_no)
        if miles_over is not None:
            a.last_pm_odometer = a.odometer - a.pm_interval_miles - miles_over
        elif am.pm_miles_over(a) < 0:
            a.last_pm_odometer = a.odometer - a.pm_interval_miles - 300
        await am.flag_pm_overdue(s, tenant_id, a)
        return {"vehicle": vehicle_label, "asset_number": asset_no, "miles_over": am.pm_miles_over(a)}


async def duplicate_last_fault(tenant_id: str, vehicle_label: str) -> dict:
    """Re-send the same DTC within the hour; the bus drops it as a duplicate."""
    async with SessionLocal() as s:
        vid = await identity.by_label(s, tenant_id, "vehicle", vehicle_label)
        device = await identity.to_external(s, tenant_id, vid, "telematics")
        recent = (await s.execute(select(TelemetryReading).where(TelemetryReading.device_id == device)
                                  .order_by(TelemetryReading.ts.desc()).limit(50))).scalars().all()
        last = next((r for r in recent if r.dtc_codes), None)
    if not last or not last.dtc_codes:
        raise ValueError(f"{vehicle_label} has no recent fault to repeat. Inject a fault first.")
    return await inject_fault(tenant_id, vehicle_label, last.dtc_codes[0])


async def set_fault_injection(tenant_id: str, target: str, mode: str) -> dict:
    if target not in FAULT_TARGETS:
        raise ValueError("Unknown failure target")
    async with session_scope() as s:
        for fi in (await s.execute(select(FaultInjection).where(FaultInjection.tenant_id == tenant_id, FaultInjection.target == target,
                                                                FaultInjection.active.is_(True)))).scalars():
            fi.active = False
        if mode == "off":
            return {"target": target, "mode": "off"}
        fi = FaultInjection(id=new_id("fi"), tenant_id=tenant_id, target=target, mode=mode, remaining=1 if mode == "fail_once" else 9999,
                            message=f"Simulated outage: {FAULT_TARGETS[target]}", active=True)
        s.add(fi)
        return {"target": target, "mode": mode}


async def list_fault_injections(tenant_id: str) -> list[dict]:
    async with SessionLocal() as s:
        active = {fi.target: fi.mode for fi in (await s.execute(select(FaultInjection).where(
            FaultInjection.tenant_id == tenant_id, FaultInjection.active.is_(True)))).scalars()}
    return [{"target": t, "description": d, "mode": active.get(t, "off")} for t, d in FAULT_TARGETS.items()]


# ---------------------------------------------------------------- background loops
class BackgroundSimulators:
    def __init__(self) -> None:
        self.telemetry_enabled = settings.telemetry_stream_enabled
        self._tasks: list[asyncio.Task] = []
        self.fault_probability = 0.04
        self.no_show_probability = 0.0

    def start(self) -> None:
        self._tasks.append(asyncio.create_task(self._telemetry_loop(), name="telemetry-stream"))
        self._tasks.append(asyncio.create_task(self._pm_loop(), name="pm-scanner"))

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass
        self._tasks.clear()

    async def _telemetry_loop(self) -> None:
        rng = random.Random()
        while True:
            await asyncio.sleep(settings.telemetry_interval_seconds)
            if not self.telemetry_enabled:
                continue
            try:
                async with SessionLocal() as s:
                    devices = list((await s.execute(select(TelemetryDevice))).scalars())
                    latest = {}
                    for tid in {d.tenant_id for d in devices}:
                        latest.update(await tl.latest_readings(s, tid))
                    from app.models import FaultCode
                    codes = [f.code for f in (await s.execute(select(FaultCode).where(FaultCode.code != "PM-DUE"))).scalars()]
                for d in rng.sample(devices, k=min(6, len(devices))):
                    odo = latest[d.device_id].odometer if d.device_id in latest else 100_000
                    dtc = rng.choice(codes) if rng.random() < self.fault_probability else None
                    async with product_session() as s:
                        await tl.ingest_reading(s, d.tenant_id, tl.synthetic_reading(d.device_id, odo + rng.randint(1, 4), dtc))
                if self.no_show_probability and rng.random() < self.no_show_probability:
                    tid = rng.choice(sorted({d.tenant_id for d in devices}))
                    try:
                        await no_show(tid, kind=rng.choice(["no_show", "no_show", "late_cancel"]))
                    except ValueError:
                        pass
            except Exception:
                log.exception("telemetry stream tick failed")

    async def _pm_loop(self) -> None:
        await asyncio.sleep(3)
        while True:
            try:
                await scan_pm_all()
            except Exception:
                log.exception("PM scan failed")
            await asyncio.sleep(settings.pm_scan_interval_seconds)


async def scan_pm_all() -> int:
    flagged = 0
    async with SessionLocal() as s:
        tenants = [t.id for t in (await s.execute(select(Tenant))).scalars()]
    for tid in tenants:
        async with product_session() as s:
            for a in await am.pm_overdue_assets(s, tid):
                await am.flag_pm_overdue(s, tid, a)  # dedupe key stops repeats until the next PM
                flagged += 1
    return flagged


background = BackgroundSimulators()


# ---------------------------------------------------------------- demo history
async def run_history() -> None:
    """Runs two complete orchestrations so dashboards and the audit log have data on first start."""
    from app.orchestrator.approvals import decide

    for tenant_id in ("ten_mvt", "ten_lsp"):
        try:
            await no_show(tenant_id, prefer="standby")
            await bus.drain()
            async with SessionLocal() as s:
                from app.models import ApprovalRequest
                dispatcher = (await s.execute(select(User).where(User.tenant_id == tenant_id, User.role == "dispatcher"))).scalar_one()
                ar = (await s.execute(select(ApprovalRequest).join(Workflow, Workflow.id == ApprovalRequest.workflow_id).where(
                    Workflow.workflow_type == "no_show_recovery", Workflow.tenant_id == tenant_id, ApprovalRequest.status == "pending"))).scalars().first()
            if ar:
                await decide(dispatcher, ar.id, "approve", note="Approved (demo history)")
                await bus.drain()
        except Exception:
            log.exception("no-show history scenario failed for %s", tenant_id)
    scenarios = [("ten_mvt", "V-104", "B1342"), ("ten_lsp", "P-205", "U0100")]
    for tenant_id, label, code in scenarios:
        try:
            await inject_fault(tenant_id, label, code)
            await bus.drain()
            async with SessionLocal() as s:
                dispatcher = (await s.execute(select(User).where(User.tenant_id == tenant_id, User.role == "dispatcher"))).scalar_one()
                shop = (await s.execute(select(User).where(User.tenant_id == tenant_id, User.role == "shop_manager"))).scalar_one()
                vid = await identity.by_label(s, tenant_id, "vehicle", label)
                wf = (await s.execute(select(Workflow).where(Workflow.vehicle_id == vid).order_by(Workflow.started_at.desc()))).scalars().first()
            for _ in range(5):
                async with SessionLocal() as s:
                    from app.models import ApprovalRequest
                    ar = (await s.execute(select(ApprovalRequest).where(ApprovalRequest.workflow_id == wf.id, ApprovalRequest.status == "pending",
                                                                       ApprovalRequest.kind == "approval"))).scalars().first()
                if not ar:
                    break
                await decide(dispatcher, ar.id, "approve", note="Approved (demo history)")
                await bus.drain()
            from app.models import WorkOrder
            async with SessionLocal() as s:
                wo = (await s.execute(select(WorkOrder).where(WorkOrder.external_ref == wf.id))).scalar_one_or_none()
            if wo:
                async with product_session() as s:
                    await am.close_work_order(s, tenant_id, wo.id, shop.full_name, "Replaced module, cleared codes, road tested")
                await bus.drain()
        except Exception:
            log.exception("history scenario %s failed", label)
