"""Shadow mode and manual-work tracking.

Shadow mode (proposal, Phase 1c): the agent runs on real events and records exactly what it would do, but
does not act and asks no one. People keep working in the products. This module watches the products' own
events for actions people take by hand and:

1. matches them to the agent's shadow recommendation for the same vehicle and step, scoring how closely the
   person did what the agent proposed and how much earlier the agent was ready (the Shadow mode screen);
2. counts every manual product entry made for an incident ("manual re-entry across products", a success
   measure), for live and shadow workflows alike. Shadow workflows also give the measured Phase 0 baseline.
"""
from datetime import timedelta
from typing import Any, Optional

from sqlalchemy import select

from app.core.clock import new_id, now
from app.core.database import session_scope
from app.core.events import CloudEvent, EventTypes
from app.core.logging import get_logger
from app.core.realtime import hub
from app.models import ShadowRecommendation, Trip, Workflow

log = get_logger("shadow")
RECENT = timedelta(hours=72)
MATCH_THRESHOLD = 75.0  # agreement at or above this counts as "matched"
WATCHED = (EventTypes.WORK_ORDER_CREATED, EventTypes.VEHICLE_AVAILABILITY_CHANGED, EventTypes.RUN_REASSIGNED,
           EventTypes.RIDER_NOTIFIED, EventTypes.SAFETY_DEFECT_OPENED)


async def record(state: dict, step: str, recommendation: dict, rules: dict) -> None:
    async with session_scope() as s:
        exists = (await s.execute(select(ShadowRecommendation.id).where(ShadowRecommendation.workflow_id == state["workflow_id"],
                                                                         ShadowRecommendation.step == step))).scalar_one_or_none()
        if exists:
            return
        s.add(ShadowRecommendation(id=new_id("shd"), tenant_id=state["tenant_id"], workflow_id=state["workflow_id"],
                                   workflow_type=state.get("workflow_type") or "vehicle_health", step=step, vehicle_id=state.get("vehicle_id"),
                                   vehicle_label=state.get("vehicle_label"), recommendation=recommendation, recommended_at=now(), status="open"))
    hub.publish(state["tenant_id"], "shadow", {"workflow_id": state["workflow_id"], "step": step})


def is_manual(event: CloudEvent) -> bool:
    d = event.data or {}
    if d.get("manual") is True:
        return True
    if event.type == EventTypes.WORK_ORDER_CREATED:
        return d.get("source") == "manual"
    return str(d.get("ref") or "").startswith("manual:")


def _step_for(event: CloudEvent) -> Optional[str]:
    if event.type in (EventTypes.WORK_ORDER_CREATED, EventTypes.SAFETY_DEFECT_OPENED):
        return "open_work_order"
    if event.type == EventTypes.VEHICLE_AVAILABILITY_CHANGED:
        return "return_to_service" if event.data.get("available") else "pull_vehicle"
    if event.type == EventTypes.RUN_REASSIGNED:
        return "reassign_runs"
    if event.type == EventTypes.RIDER_NOTIFIED:
        return "notify_riders"
    return None


def _describe(event: CloudEvent) -> str:
    d = event.data or {}
    return {
        EventTypes.WORK_ORDER_CREATED: f"Work order {d.get('work_order_id')} ({d.get('priority')}) opened by hand",
        EventTypes.SAFETY_DEFECT_OPENED: f"Vestige defect {d.get('defect_id')} recorded by hand",
        EventTypes.VEHICLE_AVAILABILITY_CHANGED: ("Vehicle returned to the schedule by hand" if d.get("available") else "Vehicle pulled from the schedule by hand"),
        EventTypes.RUN_REASSIGNED: f"Run {d.get('run_id')} reassigned by hand to {d.get('vehicle_code')} / {d.get('driver_code')}",
        EventTypes.RIDER_NOTIFIED: f"Rider message sent by hand ({d.get('kind') or 'message'})",
    }.get(event.type, event.type)


async def _run_ids_for_trip(s, trip_id: Optional[str]) -> set[str]:
    if not trip_id:
        return set()
    t = await s.get(Trip, trip_id)
    return {t.run_id} if t and t.run_id else set()


async def _workflows_for(s, event: CloudEvent) -> list[Workflow]:
    """Vehicle health workflows this manual action belongs to: same vehicle, or one of its runs at risk."""
    since = now() - RECENT
    rows = (await s.execute(select(Workflow).where(Workflow.tenant_id == event.tenantid, Workflow.workflow_type == "vehicle_health",
                                                   Workflow.started_at >= since))).scalars().all()
    d = event.data or {}
    run_ids = {d["run_id"]} if d.get("run_id") else await _run_ids_for_trip(s, d.get("trip_id"))
    out = []
    for wf in rows:
        if event.subject and wf.vehicle_id == event.subject:
            out.append(wf)
            continue
        if run_ids:
            at_risk = {r["run_id"] for r in ((wf.context or {}).get("assessment") or {}).get("runs_at_risk", [])}
            if at_risk & run_ids:
                out.append(wf)
    return out


def _agreement(rec: ShadowRecommendation, actions: list[dict]) -> float:
    r = rec.recommendation or {}
    if rec.step == "open_work_order":
        wo = [a for a in actions if a["type"] == EventTypes.WORK_ORDER_CREATED]
        if not wo:
            return 50.0  # only the safety side was done by hand
        return 100.0 if (wo[0]["data"].get("priority") == r.get("priority")) else 60.0
    if rec.step == "reassign_runs":
        plan = {x["run_id"]: x for x in r.get("assignments", []) if x.get("vehicle_id")}
        scores = []
        for a in actions:
            run_id = a["data"].get("run_id")
            p = plan.get(run_id)
            if not p:
                continue
            same_v = a["data"].get("vehicle_id") == p.get("vehicle_id")
            same_d = a["data"].get("driver_id") == p.get("driver_id")
            scores.append(100.0 if same_v and same_d else 60.0 if same_v or same_d else 20.0)
        return round(sum(scores) / len(scores), 1) if scores else 0.0
    return 100.0  # pull, notify, return: doing the step at all is agreement


async def on_product_event(event: CloudEvent) -> None:
    if event.type not in WATCHED or not is_manual(event):
        return
    step = _step_for(event)
    d = dict(event.data or {})
    async with session_scope() as s:
        if event.type == EventTypes.RUN_REASSIGNED:
            from app.identity.service import identity

            d["vehicle_id"] = await identity.to_canonical(s, event.tenantid, "trip_mgmt", d.get("vehicle_code") or "")
            d["driver_id"] = await identity.to_canonical(s, event.tenantid, "trip_mgmt", d.get("driver_code") or "")
        entry = {"event_id": event.id, "type": event.type, "step": step, "by": d.get("by"), "at": event.time.isoformat(),
                 "detail": _describe(event), "data": {k: v for k, v in d.items() if k not in ("message",)}}
        for wf in await _workflows_for(s, event):
            ctx = dict(wf.context or {})
            entries = ctx.get("manual_entries") or []
            if any(e["event_id"] == event.id for e in entries):
                continue
            ctx["manual_entries"] = entries + [entry]
            wf.context = ctx
            rec = (await s.execute(select(ShadowRecommendation).where(ShadowRecommendation.workflow_id == wf.id,
                                                                      ShadowRecommendation.step == step))).scalar_one_or_none()
            if rec:
                rec.human_actions = (rec.human_actions or []) + [entry]
                rec.first_human_at = rec.first_human_at or event.time
                rec.agreement_pct = _agreement(rec, rec.human_actions)
                rec.status = "matched" if rec.agreement_pct >= MATCH_THRESHOLD else "differed"
            hub.publish(wf.tenant_id, "workflow", {"id": wf.id, "manual_entry": event.type})


async def expire_unmatched(tenant_id: str, older_than: timedelta = timedelta(hours=24)) -> int:
    """Shadow recommendations nobody acted on within a day: the person decided no action was needed."""
    async with session_scope() as s:
        rows = (await s.execute(select(ShadowRecommendation).where(ShadowRecommendation.tenant_id == tenant_id, ShadowRecommendation.status == "open",
                                                                   ShadowRecommendation.recommended_at < now() - older_than))).scalars().all()
        for r in rows:
            r.status = "no_action"
        return len(rows)


def to_dict(r: ShadowRecommendation, wf: Optional[Workflow] = None) -> dict[str, Any]:
    out = {c.name: getattr(r, c.name) for c in ShadowRecommendation.__table__.columns}
    out["agent_ahead_minutes"] = (round((r.first_human_at - r.recommended_at).total_seconds() / 60, 1)
                                  if r.first_human_at and r.recommended_at else None)
    if wf:
        out.update(workflow_title=wf.title, severity=wf.severity, detected_at=wf.detected_at)
    return out


async def summary(s, tenant_id: str) -> dict[str, Any]:
    rows = (await s.execute(select(ShadowRecommendation).where(ShadowRecommendation.tenant_id == tenant_id))).scalars().all()
    by_step: dict[str, dict] = {}
    for r in rows:
        b = by_step.setdefault(r.step, {"step": r.step, "recommended": 0, "matched": 0, "differed": 0, "no_action": 0, "open": 0,
                                        "agreement": [], "ahead": [], "agent_better": 0, "human_better": 0, "same": 0})
        b["recommended"] += 1
        b[r.status] = b.get(r.status, 0) + 1
        if r.agreement_pct is not None:
            b["agreement"].append(r.agreement_pct)
        if r.first_human_at:
            b["ahead"].append((r.first_human_at - r.recommended_at).total_seconds() / 60)
        if r.verdict:
            b[r.verdict] = b.get(r.verdict, 0) + 1
    out = []
    for b in by_step.values():
        ag, ah = b.pop("agreement"), sorted(b.pop("ahead"))
        b["agreement_pct"] = round(sum(ag) / len(ag), 1) if ag else None
        b["median_agent_ahead_minutes"] = round(ah[len(ah) // 2], 1) if ah else None
        decided = b["matched"] + b["differed"]
        b["ready_to_go_live"] = decided >= 5 and (b["agreement_pct"] or 0) >= 80 and b["human_better"] <= b["agent_better"] + b["same"]
        out.append(b)
    order = ["open_work_order", "pull_vehicle", "reassign_runs", "notify_riders", "return_to_service", "adjust_schedule"]
    out.sort(key=lambda x: order.index(x["step"]) if x["step"] in order else 99)
    return {"steps": out, "total": len(rows)}
