from datetime import datetime, time, timedelta

from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, SessionDep
from app.core.clock import now
from app.identity.service import identity
from app.models import Asset, CanonicalEntity, FleetVehicle, Run, TelemetryReading, WorkOrder, Workflow
from app.products.asset_mgmt.service import pm_miles_over
from app.products.telematics.service import latest_readings
from app.products.trip_mgmt.service import active_blocks

router = APIRouter(prefix="/api/fleet", tags=["fleet (unified view)"])


@router.get("")
async def fleet(user: CurrentUser, s: SessionDep):
    """One row per vehicle, joined across asset mgmt, trip mgmt and telematics via the identity crosswalk.
    With READ_SOURCE=databricks the product tables are read from Databricks (see core/hybrid_session.py)."""
    return await build_fleet(user.tenant_id, s)


async def build_fleet(tid: str, s: AsyncSession) -> list[dict]:
    vehicles = (await s.execute(select(CanonicalEntity).where(CanonicalEntity.tenant_id == tid, CanonicalEntity.entity_type == "vehicle")
                                .order_by(CanonicalEntity.label))).scalars().all()
    am_map = {c: e for e, c in (await identity.map_for_system(s, tid, "asset_mgmt", "vehicle")).items()}
    tm_map = {c: e for e, c in (await identity.map_for_system(s, tid, "trip_mgmt", "vehicle")).items()}
    tl_map = {c: e for e, c in (await identity.map_for_system(s, tid, "telematics", "vehicle")).items()}
    sf_map = {c: e for e, c in (await identity.map_for_system(s, tid, "safety", "vehicle")).items()}
    from app.models import SafetyDefect

    defects: dict[str, list] = {}
    for d in (await s.execute(select(SafetyDefect).where(SafetyDefect.tenant_id == tid, SafetyDefect.status == "open"))).scalars():
        defects.setdefault(d.vehicle_ref, []).append({"id": d.id, "category": d.category, "severity": d.severity, "out_of_service": d.out_of_service})
    assets = {a.asset_number: a for a in (await s.execute(select(Asset).where(Asset.tenant_id == tid))).scalars()}
    fvs = {v.vehicle_code: v for v in (await s.execute(select(FleetVehicle).where(FleetVehicle.tenant_id == tid))).scalars()}
    readings = await latest_readings(s, tid)
    open_wos: dict[str, list] = {}
    for w in (await s.execute(select(WorkOrder).where(WorkOrder.tenant_id == tid, WorkOrder.status.in_(["open", "in_progress"])))).scalars():
        open_wos.setdefault(w.asset_number, []).append({"id": w.id, "title": w.title, "status": w.status, "priority": w.priority})
    blocks = {b.vehicle_code: b for b in await active_blocks(s, tid, now(), now() + timedelta(seconds=1))}
    today = now().date()
    runs_today = dict((await s.execute(select(Run.vehicle_code, func.count()).where(Run.tenant_id == tid, Run.service_date == today)
                                       .group_by(Run.vehicle_code))).all())
    active_wf = {w.vehicle_id: w for w in (await s.execute(select(Workflow).where(
        Workflow.tenant_id == tid, Workflow.status.in_(["running", "awaiting_approval", "awaiting_event"])))).scalars()}
    out = []
    for v in vehicles:
        a = assets.get(am_map.get(v.id))
        fv = fvs.get(tm_map.get(v.id))
        r = readings.get(tl_map.get(v.id))
        blk = blocks.get(fv.vehicle_code) if fv else None
        wf = active_wf.get(v.id)
        out.append({
            "vehicle_id": v.id, "label": v.label,
            "ids": {"asset_mgmt": am_map.get(v.id), "trip_mgmt": tm_map.get(v.id), "telematics": tl_map.get(v.id), "safety": sf_map.get(v.id)},
            "open_defects": defects.get(sf_map.get(v.id), []),
            "vehicle_type": fv.vehicle_type if fv else None, "capacity": fv.capacity if fv else None,
            "wheelchair_positions": fv.wheelchair_positions if fv else None, "depot": fv.depot if fv else None,
            "schedule_status": "unavailable" if blk else (fv.status if fv else None),
            "unavailable_until": blk.end if blk else None, "unavailable_reason": blk.reason if blk else None,
            "asset_status": a.status if a else None, "make_model": f"{a.year} {a.make} {a.model}" if a else None,
            "odometer": a.odometer if a else None, "pm_miles_over": pm_miles_over(a) if a else None,
            "open_work_orders": open_wos.get(a.asset_number, []) if a else [],
            "runs_today": runs_today.get(fv.vehicle_code, 0) if fv else 0,
            "telemetry": {"ts": r.ts, "engine_temp_c": r.engine_temp_c, "oil_pressure_kpa": r.oil_pressure_kpa, "battery_v": r.battery_v,
                          "dtc_codes": r.dtc_codes} if r else None,
            "active_workflow": {"id": wf.id, "status": wf.status, "current_step": wf.current_step} if wf else None,
        })
    return out
