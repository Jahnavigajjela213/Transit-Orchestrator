"""Scenario testing with replayed events (proposal, Phase 1b).

Two ways in:
- Built-in scenarios generate realistic CloudEvents against today's synthetic data: a peak-hour brake fault with a
  repeated signal, a fault storm across three vehicles, late / out-of-order / stale signals, a cluster of no-shows.
- Any exported event file (GET /api/events/export, JSON Lines of CloudEvents, e.g. captured from a real tenant's
  EventBridge archive) can be replayed. Events get new ids, their times are shifted so the newest lands at "now"
  (gaps preserved), and dedupe keys are namespaced to the replay unless you ask to keep them.
Everything goes through the normal event backbone, so de-duplication, ordering, policy and audit all apply.
"""
from datetime import timedelta
from typing import Any, Optional

from sqlalchemy import select

from app.core.clock import new_id, now
from app.core.database import SessionLocal
from app.core.event_bus import bus
from app.core.events import CloudEvent, EventTypes
from app.identity.service import identity
from app.models import FaultCode, Run, Workflow

SCENARIOS = [
    {"id": "peak_brake_fault", "title": "Peak-hour brake fault, repeated signal",
     "description": "A bus with runs ahead reports BRK-02 (critical). The device repeats the code 30 s later (dropped as a duplicate), "
                    "then asset management flags it overdue for PM (attached to the same orchestration, no second workflow)."},
    {"id": "fault_storm", "title": "Fault storm: three vehicles in two minutes",
     "description": "Coolant over-temperature, ABS fault and a wheelchair lift fault on three different vehicles. Three orchestrations run "
                    "side by side; brake and lift faults are also logged as Vestige defects."},
    {"id": "late_out_of_order", "title": "Late, out-of-order and stale signals",
     "description": "A fault that happened 20 min ago arrives now (handled, marked late); a PM flag from 3 min ago is published first but "
                    "dispatched after the older fault (event-time order); a 30 h old fault is recorded as stale and not acted on."},
    {"id": "no_show_cluster", "title": "No-show cluster",
     "description": "Two no-shows: one where a standby rider can take the seat, one on a run that is running late."},
]


async def _free_vehicles(tenant_id: str, n: int) -> list[tuple[str, str, str]]:
    """(canonical id, label, telematics device) for in-service vehicles with runs ahead and no recent orchestration."""
    t = now()
    async with SessionLocal() as s:
        busy = set((await s.execute(select(Workflow.vehicle_id).where(
            Workflow.tenant_id == tenant_id, Workflow.workflow_type == "vehicle_health",
            (Workflow.status.in_(["running", "awaiting_approval", "awaiting_event"])) | (Workflow.started_at > t - timedelta(hours=2))))).scalars())
        codes = []
        for code in (await s.execute(select(Run.vehicle_code).where(Run.tenant_id == tenant_id, Run.start_time > t, Run.vehicle_code.is_not(None))
                                     .order_by(Run.start_time))).scalars():
            if code not in codes:
                codes.append(code)
        out = []
        for code in codes:
            cid = await identity.to_canonical(s, tenant_id, "trip_mgmt", code)
            if not cid or cid in busy:
                continue
            device = await identity.to_external(s, tenant_id, cid, "telematics")
            out.append((cid, await identity.label(s, cid) or cid, device))
            if len(out) == n:
                break
    if len(out) < n:
        raise ValueError("Not enough vehicles with upcoming runs. Reset the demo data to get a fresh day.")
    return out


async def _fault_event(tenant_id: str, vehicle: tuple[str, str, str], code: str, at, dedupe_suffix: str = "") -> CloudEvent:
    cid, label, device = vehicle
    async with SessionLocal() as s:
        fc = await s.get(FaultCode, code)
    return CloudEvent(type=EventTypes.VEHICLE_FAULT_DETECTED, source="telematics", subject=cid, tenantid=tenant_id, time=at,
                      data={"device_id": device, "fault_code": code, "description": fc.description if fc else code, "scenario": True,
                            "reading": {"device_id": device}},
                      dedupekey=f"dtc:{device}:{code}:{at:%Y%m%d%H}{dedupe_suffix}")


async def build(tenant_id: str, scenario_id: str) -> list[CloudEvent]:
    t = now()
    if scenario_id == "peak_brake_fault":
        v = (await _free_vehicles(tenant_id, 1))[0]
        first = await _fault_event(tenant_id, v, "BRK-02", t)
        repeat = await _fault_event(tenant_id, v, "BRK-02", t + timedelta(seconds=30))
        repeat.dedupekey = first.dedupekey  # same device, code and hour: a duplicate
        async with SessionLocal() as s:
            asset = await identity.to_external(s, tenant_id, v[0], "asset_mgmt")
        pm = CloudEvent(type=EventTypes.VEHICLE_PM_OVERDUE, source="asset_mgmt", subject=v[0], tenantid=tenant_id, time=t + timedelta(minutes=1),
                        data={"asset_number": asset, "unit_label": v[1], "miles_over": 900, "scenario": True}, dedupekey=f"pm:{asset}:scenario:{t:%H%M%S}")
        return [first, repeat, pm]
    if scenario_id == "fault_storm":
        vs = await _free_vehicles(tenant_id, 3)
        return [await _fault_event(tenant_id, vs[0], "P0217", t - timedelta(minutes=2)),
                await _fault_event(tenant_id, vs[1], "C1201", t - timedelta(minutes=1)),
                await _fault_event(tenant_id, vs[2], "LIFT-01", t)]
    if scenario_id == "late_out_of_order":
        vs = await _free_vehicles(tenant_id, 3)
        async with SessionLocal() as s:
            asset = await identity.to_external(s, tenant_id, vs[1][0], "asset_mgmt")
        newer_pm = CloudEvent(type=EventTypes.VEHICLE_PM_OVERDUE, source="asset_mgmt", subject=vs[1][0], tenantid=tenant_id, time=t - timedelta(minutes=3),
                              data={"asset_number": asset, "unit_label": vs[1][1], "miles_over": 400, "scenario": True},
                              dedupekey=f"pm:{asset}:scenario:{t:%H%M%S}")
        older_late_fault = await _fault_event(tenant_id, vs[0], "P0520", t - timedelta(minutes=20))
        stale = await _fault_event(tenant_id, vs[2], "P0300", t - timedelta(hours=30))
        return [newer_pm, older_late_fault, stale]  # published in this (wrong) order on purpose
    raise ValueError(f"Unknown scenario {scenario_id}")


async def run_scenario(tenant_id: str, scenario_id: str) -> dict[str, Any]:
    if scenario_id == "no_show_cluster":
        from app.simulator.service import no_show

        out = []
        for prefer in ("standby", "late"):
            try:
                out.append({"prefer": prefer, **(await no_show(tenant_id, None, "no_show", prefer))})
            except ValueError as e:
                out.append({"prefer": prefer, "error": str(e)})
        await bus.drain()
        return {"scenario": scenario_id, "no_shows": out}
    events = await build(tenant_id, scenario_id)
    results = []
    for e in events:
        r = await bus.publish(e)
        results.append({"id": r.event_id, "type": e.type, "subject": e.subject, "time": e.time.isoformat(), "publish_status": r.status})
    await bus.drain()
    return {"scenario": scenario_id, "events": await _final_status(results)}


async def _final_status(results: list[dict]) -> list[dict]:
    from app.models import EventRecord

    async with SessionLocal() as s:
        for r in results:
            rec = await s.get(EventRecord, r["id"])
            if rec:
                r.update(status=rec.status, note=rec.note, error=rec.error)
    return results


async def replay_events(tenant_id: str, events: list[dict], *, shift_to_now: bool = True, keep_dedupe: bool = False) -> dict[str, Any]:
    if not events:
        raise ValueError("No events to replay.")
    if len(events) > 2000:
        raise ValueError("At most 2,000 events per replay.")
    parsed = [CloudEvent.model_validate(e) for e in events]
    for e in parsed:
        if e.time.tzinfo is not None:
            e.time = e.time.astimezone().replace(tzinfo=None)
    delta = (now() - max(e.time for e in parsed)) if shift_to_now else timedelta(0)
    run_id = new_id("rpl")
    results = []
    for e in sorted(parsed, key=lambda x: x.time):
        orig = e.id
        e = e.model_copy(update={"id": new_id("evt"), "tenantid": tenant_id, "time": e.time + delta, "correlationid": None,
                                 "dedupekey": e.dedupekey if keep_dedupe else (f"{run_id}:{e.dedupekey}" if e.dedupekey else None),
                                 "data": {**e.data, "replayed_from": orig, "replay_run": run_id}})
        r = await bus.publish(e)
        results.append({"original_id": orig, "id": r.event_id, "type": e.type, "subject": e.subject, "time": e.time.isoformat(), "publish_status": r.status})
    await bus.drain()
    return {"replay_run": run_id, "shifted_by_minutes": round(delta.total_seconds() / 60, 1), "events": await _final_status(results)}
