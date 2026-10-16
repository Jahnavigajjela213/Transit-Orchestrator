"""Success measures from the proposal, computed live from workflows and the audit log."""
import re
from datetime import timedelta

from statistics import median
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import case, func, select

from app.api.deps import CurrentUser, SessionDep, require_roles
from app.audit.service import is_complete
from app.core.clock import now
from app.core.realtime import hub
from app.models import ApprovalRequest, AuditOutbox, AuditRecord, EventRecord, LLMUsage, TenantBaseline, User, Workflow
from app.orchestrator import shadow
from app.policy.engine import policy_engine

router = APIRouter(prefix="/api/metrics", tags=["metrics"])

# Phase 0 baseline: how the agency works without the agent. Nothing is made up: it is either entered by an admin from
# discovery, or measured from shadow-mode incidents that people handled by hand (live, until it is saved). Keys with no
# data are None and the Overview shows no "before" for them.
BASELINE_KEYS = ("detect_to_work_order_minutes", "manual_reentries_per_incident", "runs_covered_pct", "audit_complete_pct",
                 "manual_steps_to_return")
READY_MIN_DECISIONS = 10  # defaults; a policy can set its own under "readiness"
READY_MIN_ACCEPTANCE = 90


def _empty_baseline() -> dict:
    return {k: None for k in BASELINE_KEYS}


async def baseline_for(s, tenant_id: str) -> dict:
    b = await s.get(TenantBaseline, tenant_id)
    if b:
        return {"values": {**_empty_baseline(), **(b.values or {})}, "source": b.source, "notes": b.notes, "updated_by": b.updated_by,
                "updated_at": b.updated_at, "sample": None}
    measured, sample = await _measure_from_shadow(s, tenant_id)
    if sample:
        return {"values": {**_empty_baseline(), **measured}, "source": "shadow_live", "updated_by": None, "updated_at": None, "sample": sample,
                "notes": f"Measured live from {sample} shadow-mode incident(s) handled by hand."}
    return {"values": _empty_baseline(), "source": "none", "updated_by": None, "updated_at": None, "sample": 0,
            "notes": "No baseline yet: enter the Phase 0 numbers, or run in shadow mode and handle a few incidents by hand."}


def _manual_entries(w: Workflow) -> list[dict]:
    return (w.context or {}).get("manual_entries") or []


@router.get("/summary")
async def summary(user: CurrentUser, s: SessionDep):
    tid = user.tenant_id
    all_wfs = (await s.execute(select(Workflow).where(Workflow.tenant_id == tid))).scalars().all()
    shadow_wfs = [w for w in all_wfs if w.status == "shadow"]
    wfs = [w for w in all_wfs if w.workflow_type == "vehicle_health" and w.status != "shadow"]
    ns = [w for w in all_wfs if w.workflow_type == "no_show_recovery"]
    recs = [(w.context or {}).get("recovery") for w in ns if (w.context or {}).get("recovery")]
    no_show = {
        "orchestrations": len(ns), "finished": len(recs),
        "minutes_freed": sum(r["minutes_saved"] for r in recs),
        "standby_riders_booked": sum(1 for r in recs if r["standby_booked"]),
        "pickups_retimed": sum(r["pickups_moved"] for r in recs),
        "late_pickups_avoided": sum(max(0, r["late_before"] - r["late_after"]) for r in recs),
        "riders_notified": sum(r["riders_notified"] for r in recs),
        "riders_flagged_for_review": sum(1 for r in recs if r["flag_rider"]),
        "recovered_pct": round(100 * sum(1 for r in recs if r["recovered"]) / len(recs)) if recs else None,
    }
    with_wo = [w for w in wfs if w.work_order_opened_at and w.detected_at]
    mins = [(w.work_order_opened_at - w.detected_at).total_seconds() / 60 for w in with_wo]
    at_risk = sum(w.runs_at_risk for w in wfs if w.pulled_at)
    covered = sum(w.runs_covered for w in wfs if w.pulled_at)
    returned_needed = [w for w in wfs if w.pulled_at and w.status not in ("running", "awaiting_approval", "awaiting_event")]
    returned_auto = [w for w in returned_needed if w.returned_at]

    audits = (await s.execute(select(AuditRecord).where(AuditRecord.tenant_id == tid, AuditRecord.workflow_id.is_not(None)))).scalars().all()
    by_wf: dict[str, list] = {}
    for a in audits:
        by_wf.setdefault(a.workflow_id, []).append(a)
    complete = [wid for wid, recs in by_wf.items() if all(is_complete(r) for r in recs) and any(r.record_type == "assessment" for r in recs)]

    decided = (await s.execute(select(ApprovalRequest.step, ApprovalRequest.status, func.count()).where(
        ApprovalRequest.tenant_id == tid, ApprovalRequest.kind == "approval", ApprovalRequest.status.in_(["approved", "rejected", "overridden"]),
        ApprovalRequest.decided_at >= now() - timedelta(days=7)).group_by(ApprovalRequest.step, ApprovalRequest.status))).all()
    acceptance: dict[str, dict] = {}
    for step, status, n in decided:
        acceptance.setdefault(step, {"approved": 0, "rejected": 0, "overridden": 0})[status] = n
    for v in acceptance.values():
        total = sum(v.values())
        v["acceptance_pct"] = round(100 * v["approved"] / total) if total else None
    # Weekly acceptance (last 8 weeks) and which semi-autonomous steps have earned a move to autonomous.
    since = now() - timedelta(weeks=8)
    hist = (await s.execute(select(ApprovalRequest.step, ApprovalRequest.status, ApprovalRequest.decided_at).where(
        ApprovalRequest.tenant_id == tid, ApprovalRequest.kind == "approval", ApprovalRequest.status.in_(["approved", "rejected", "overridden"]),
        ApprovalRequest.decided_at >= since))).all()
    weekly: dict[str, dict[str, dict]] = {}
    for step, st, at in hist:
        week = (at - timedelta(days=at.weekday())).date().isoformat()
        w = weekly.setdefault(step, {}).setdefault(week, {"week": week, "approved": 0, "rejected": 0, "overridden": 0})
        w[st] += 1
    trend = {step: sorted(({**w, "acceptance_pct": round(100 * w["approved"] / max(1, w["approved"] + w["rejected"] + w["overridden"]))}
                           for w in weeks.values()), key=lambda x: x["week"]) for step, weeks in weekly.items()}
    readiness = []
    for wtype in ("vehicle_health", "no_show_recovery"):
        rules = await policy_engine.rules(s, tid, wtype)
        need = rules.get("readiness") or {}
        min_n, min_pct = int(need.get("min_decisions", READY_MIN_DECISIONS)), float(need.get("min_acceptance_pct", READY_MIN_ACCEPTANCE))
        for step, cfg in rules["steps"].items():
            if cfg.get("level") != "semi_autonomous":
                continue
            recent = [x for x in hist if x[0] == step and x[2] >= now() - timedelta(days=28)]
            n = len(recent)
            ok = sum(1 for x in recent if x[1] == "approved")
            pct = round(100 * ok / n) if n else None
            readiness.append({"workflow_type": wtype, "step": step, "decisions_28d": n, "acceptance_pct": pct,
                              "ready": n >= min_n and (pct or 0) >= min_pct,
                              "rule": f"{min_n}+ decisions in 28 days with {min_pct:g}%+ approved unchanged"})
    outbox = dict((await s.execute(select(AuditOutbox.status, func.count()).where(AuditOutbox.tenant_id == tid).group_by(AuditOutbox.status))).all())
    live_with_entries = [w for w in wfs if w.status not in ("running", "awaiting_approval")] or wfs
    base = await baseline_for(s, tid)
    pending = (await s.execute(select(func.count()).select_from(ApprovalRequest).where(ApprovalRequest.tenant_id == tid,
                                                                                    ApprovalRequest.status == "pending"))).scalar_one()
    usage = (await s.execute(select(LLMUsage.provider, LLMUsage.model, func.count(), func.sum(LLMUsage.input_tokens), func.sum(LLMUsage.output_tokens),
                                    func.sum(LLMUsage.cost_usd), func.sum(case((LLMUsage.fallback.is_(True), 1), else_=0))).where(LLMUsage.tenant_id == tid)
                             .group_by(LLMUsage.provider, LLMUsage.model))).all()
    events = dict((await s.execute(select(EventRecord.status, func.count()).where(EventRecord.tenant_id == tid).group_by(EventRecord.status))).all())
    status_counts: dict[str, int] = {}
    for w in all_wfs:
        status_counts[w.status] = status_counts.get(w.status, 0) + 1
    return {
        "baseline": base["values"], "baseline_source": base["source"], "baseline_updated_at": base["updated_at"],
        "baseline_notes": base["notes"], "baseline_updated_by": base["updated_by"],
        "operations": await _operations(s, tid),
        "generated_at": now(),
        "measures": {
            "detect_to_work_order_minutes": round(sum(mins) / len(mins), 1) if mins else None,
            "detect_to_work_order_samples": len(mins),
            "manual_reentries_per_incident": (round(sum(len(_manual_entries(w)) for w in live_with_entries) / len(live_with_entries), 1)
                                              if live_with_entries else None),
            "manual_reentries_total": sum(len(_manual_entries(w)) for w in wfs),
            "approval_clicks_per_incident": round(sum(w.human_touches for w in wfs) / len(wfs), 1) if wfs else None,
            "runs_covered_pct": round(100 * covered / at_risk) if at_risk else None,
            "runs_at_risk_total": at_risk, "runs_covered_total": covered,
            "audit_complete_pct": round(100 * len(complete) / len(by_wf)) if by_wf else None,
            "auto_returned_pct": round(100 * len(returned_auto) / len(returned_needed)) if returned_needed else None,
            "dispatcher_acceptance": acceptance,
            "dispatcher_acceptance_weekly": trend,
        },
        "autonomy_readiness": readiness,
        "shadow": {"workflows": len(shadow_wfs), **(await shadow.summary(s, tid))},
        "audit_mirror": {"pending": outbox.get("pending", 0), "sent": outbox.get("sent", 0), "failed": outbox.get("failed", 0)},
        "no_show": no_show,
        "workflows": {"total": len(all_wfs), "vehicle_health": len(wfs), "no_show_recovery": len(ns), "by_status": status_counts},
        "pending_attention": pending, "events": events,
        "llm_usage": [{"provider": p, "model": m, "calls": c, "input_tokens": i or 0, "output_tokens": o or 0, "cost_usd": round(cost or 0, 4),
                       "fallbacks": int(fb or 0)} for p, m, c, i, o, cost, fb in usage],
        "live_connections": hub.connections,
    }


# ---------------------------------------------------------------- pilot measures page
ACTIVE = ("running", "awaiting_approval", "awaiting_event")
APPROVAL_STEPS = ("open_work_order", "pull_vehicle", "reassign_runs")


def _pilot_values(wfs: list[Workflow], complete_ids: set[str], audited_ids: set[str], decisions: list[tuple]) -> dict:
    """The proposal's six success measures over one set of vehicle-health workflows and the decisions on them."""
    mins = [(w.work_order_opened_at - w.detected_at).total_seconds() / 60 for w in wfs if w.work_order_opened_at and w.detected_at]
    finished = [w for w in wfs if w.status not in ACTIVE]
    pulled = [w for w in wfs if w.pulled_at]
    at_risk, covered = sum(w.runs_at_risk for w in pulled), sum(w.runs_covered for w in pulled)
    audited = [w for w in wfs if w.id in audited_ids]
    returned_needed = [w for w in pulled if w.status not in ACTIVE]
    ok = sum(1 for d in decisions if d[1] == "approved")
    return {
        "detect_to_work_order_minutes": round(median(mins), 1) if mins else None,
        "detect_to_work_order_samples": len(mins),
        "manual_reentries_per_incident": round(sum(len(_manual_entries(w)) for w in finished) / len(finished), 1) if finished else None,
        "runs_covered_pct": round(100 * covered / at_risk) if at_risk else None,
        "runs_at_risk": at_risk, "runs_covered": covered,
        "audit_complete_pct": round(100 * sum(1 for w in audited if w.id in complete_ids) / len(audited)) if audited else None,
        "acceptance_pct": round(100 * ok / len(decisions)) if decisions else None,
        "decisions": len(decisions),
        "auto_returned_pct": round(100 * sum(1 for w in returned_needed if w.returned_at) / len(returned_needed)) if returned_needed else None,
        "incidents": len(wfs),
    }


@router.get("/pilot")
async def pilot(user: CurrentUser, s: SessionDep, days: Optional[int] = None):
    """Pilot measures for the period (days=7, 28, or none for pilot to date), an 8-week trend of each, and dispatcher
    acceptance by approval step. Baseline from Phase 0 (or shadow mode); targets from the proposal."""
    tid, t_now = user.tenant_id, now()
    since = t_now - timedelta(days=days) if days else None
    wfs = [w for w in (await s.execute(select(Workflow).where(Workflow.tenant_id == tid, Workflow.workflow_type == "vehicle_health",
                                                              Workflow.status != "shadow"))).scalars().all()]
    audits = (await s.execute(select(AuditRecord).where(AuditRecord.tenant_id == tid, AuditRecord.workflow_id.is_not(None)))).scalars().all()
    by_wf: dict[str, list] = {}
    for a in audits:
        by_wf.setdefault(a.workflow_id, []).append(a)
    complete_ids = {wid for wid, recs in by_wf.items() if all(is_complete(r) for r in recs) and any(r.record_type == "assessment" for r in recs)}
    audited_ids = set(by_wf)
    rows = (await s.execute(select(ApprovalRequest.step, ApprovalRequest.status, ApprovalRequest.decided_at, ApprovalRequest.workflow_id).where(
        ApprovalRequest.tenant_id == tid, ApprovalRequest.kind == "approval", ApprovalRequest.status.in_(["approved", "rejected", "overridden"]),
        ApprovalRequest.decided_at.is_not(None)))).all()
    vh_ids = {w.id for w in wfs}
    decisions = [r for r in rows if r[3] in vh_ids]

    in_period = [w for w in wfs if not since or (w.detected_at and w.detected_at >= since)]
    dec_period = [d for d in decisions if not since or d[2] >= since]
    current = _pilot_values(in_period, complete_ids, audited_ids, dec_period)

    # 8 weekly buckets, oldest first, Monday-based in agency time
    this_monday = (t_now - timedelta(days=t_now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    weeks = []
    for i in range(7, -1, -1):
        w0, w1 = this_monday - timedelta(weeks=i), this_monday - timedelta(weeks=i - 1)
        ws = [w for w in wfs if w.detected_at and w0 <= w.detected_at < w1]
        ds = [d for d in decisions if w0 <= d[2] < w1]
        weeks.append({"week": w0.date().isoformat(), **_pilot_values(ws, complete_ids, audited_ids, ds)})

    steps = []
    for step in APPROVAL_STEPS:
        mine = [d for d in dec_period if d[0] == step]
        counts = {k: sum(1 for d in mine if d[1] == k) for k in ("approved", "overridden", "rejected")}
        weekly = []
        for i in range(7, -1, -1):
            w0, w1 = this_monday - timedelta(weeks=i), this_monday - timedelta(weeks=i - 1)
            ds = [d for d in decisions if d[0] == step and w0 <= d[2] < w1]
            ok = sum(1 for d in ds if d[1] == "approved")
            weekly.append({"week": w0.date().isoformat(), "decisions": len(ds), "acceptance_pct": round(100 * ok / len(ds)) if ds else None})
        total = sum(counts.values())
        steps.append({"step": step, **counts, "decisions": total, "acceptance_pct": round(100 * counts["approved"] / total) if total else None,
                      "weekly": weekly})
    readiness = {r["step"]: r for r in (await summary_readiness(s, tid))}
    for st in steps:
        r = readiness.get(st["step"])
        st["ready"], st["rule"], st["level"] = (r or {}).get("ready", False), (r or {}).get("rule"), (r or {}).get("level")
    base = await baseline_for(s, tid)
    # How many incidents the baseline rests on (shadow baselines only), so the page can warn when it is too few to trust.
    sample = base.get("sample")
    if sample is None and base["source"] == "measured_shadow" and base["notes"]:
        m = re.search(r"(\d+) shadow", base["notes"])
        sample = int(m.group(1)) if m else None
    return {"days": days, "measures": current, "weeks": weeks, "steps": steps,
            "baseline": base["values"], "baseline_source": base["source"], "baseline_notes": base["notes"],
            "baseline_sample": sample, "baseline_updated_by": base.get("updated_by"), "generated_at": t_now}


async def summary_readiness(s, tid: str) -> list[dict]:
    """Which approval steps have earned a move to autonomous (same rule as the summary), with each step's current level."""
    rules = await policy_engine.rules(s, tid, "vehicle_health")
    need = rules.get("readiness") or {}
    min_n, min_pct = int(need.get("min_decisions", READY_MIN_DECISIONS)), float(need.get("min_acceptance_pct", READY_MIN_ACCEPTANCE))
    hist = (await s.execute(select(ApprovalRequest.step, ApprovalRequest.status).where(
        ApprovalRequest.tenant_id == tid, ApprovalRequest.kind == "approval", ApprovalRequest.status.in_(["approved", "rejected", "overridden"]),
        ApprovalRequest.decided_at >= now() - timedelta(days=28)))).all()
    out = []
    for step, cfg in rules["steps"].items():
        recent = [h for h in hist if h[0] == step]
        n, ok = len(recent), sum(1 for h in recent if h[1] == "approved")
        pct = round(100 * ok / n) if n else None
        out.append({"step": step, "level": cfg.get("level"), "decisions_28d": n, "acceptance_pct": pct,
                    "ready": cfg.get("level") == "semi_autonomous" and n >= min_n and (pct or 0) >= min_pct,
                    "rule": f"{min_n}+ decisions in 28 days with {min_pct:g}%+ approved unchanged"})
    return out


@router.get("/baseline")
async def get_baseline(user: CurrentUser, s: SessionDep):
    return await baseline_for(s, user.tenant_id)


@router.delete("/baseline")
async def clear_baseline(s: SessionDep, user: User = Depends(require_roles("admin"))):
    """Forget the saved baseline: the Overview goes back to measuring it live from shadow mode (or showing none)."""
    b = await s.get(TenantBaseline, user.tenant_id)
    if b:
        await s.delete(b)
        await s.commit()
    return await baseline_for(s, user.tenant_id)


async def _operations(s, tid: str) -> dict:
    """The agency's operations right now, straight from the product data (Databricks when READ_SOURCE=databricks).
    One query per product table, so each runs wherever that table lives."""
    from app.models import (AvailabilityBlock, FleetVehicle, Notification, OpsRunHistory, Run, SafetyDefect, SafetyDriver, Trip,
                            WorkOrder)
    from app.products.safety.service import compliance

    t = now()
    today = t.date()
    vehicles = dict((await s.execute(select(FleetVehicle.status, func.count()).where(FleetVehicle.tenant_id == tid)
                                     .group_by(FleetVehicle.status))).all())
    blocked = (await s.execute(select(func.count(func.distinct(AvailabilityBlock.vehicle_code))).where(
        AvailabilityBlock.tenant_id == tid, AvailabilityBlock.active.is_(True), AvailabilityBlock.start <= t, AvailabilityBlock.end > t))).scalar_one()
    wos = (await s.execute(select(WorkOrder.priority, func.count()).where(WorkOrder.tenant_id == tid, WorkOrder.status.in_(["open", "in_progress"]))
                           .group_by(WorkOrder.priority))).all()
    defects = (await s.execute(select(func.count(), func.sum(case((SafetyDefect.out_of_service.is_(True), 1), else_=0))).where(
        SafetyDefect.tenant_id == tid, SafetyDefect.status == "open"))).one()
    drivers = [compliance(d, today) for d in (await s.execute(select(SafetyDriver).where(SafetyDriver.tenant_id == tid))).scalars()]
    runs = (await s.execute(select(func.count(), func.sum(case((Run.reassigned.is_(True), 1), else_=0)),
                                   func.sum(case((Run.delay_minutes > 5, 1), else_=0))).where(
        Run.tenant_id == tid, Run.service_date == today, Run.status != "cancelled"))).one()
    day_start = t.replace(hour=0, minute=0, second=0, microsecond=0)
    trips = dict((await s.execute(select(Trip.status, func.count()).where(
        Trip.tenant_id == tid, Trip.pickup_time >= day_start, Trip.pickup_time < day_start + timedelta(days=1)).group_by(Trip.status))).all())
    messages = (await s.execute(select(func.count()).select_from(Notification).where(
        Notification.tenant_id == tid, Notification.created_at >= t - timedelta(hours=24)))).scalar_one()
    # on-time performance: last 30 days of history against the 30 before
    last = (await s.execute(select(func.max(OpsRunHistory.service_date)).where(OpsRunHistory.tenant_id == tid))).scalar_one()
    otp = {"last_30d": None, "prior_30d": None, "road_calls_30d": None, "no_shows_30d": None, "as_of": last}
    if last:
        async def window(days_back: int) -> tuple:
            hi, lo = last - timedelta(days=days_back), last - timedelta(days=days_back + 29)
            return (await s.execute(select(func.sum(OpsRunHistory.on_time_pickups), func.sum(OpsRunHistory.completed_trips),
                                           func.sum(case((OpsRunHistory.road_call.is_(True), 1), else_=0)), func.sum(OpsRunHistory.no_shows))
                                    .where(OpsRunHistory.tenant_id == tid, OpsRunHistory.service_date >= lo, OpsRunHistory.service_date <= hi))).one()
        on, done, calls, ns = await window(0)
        pon, pdone, _, _ = await window(30)
        otp.update(last_30d=round(100 * on / done, 1) if done else None, prior_30d=round(100 * pon / pdone, 1) if pdone else None,
                   road_calls_30d=int(calls or 0), no_shows_30d=int(ns or 0))
    return {
        "vehicles": {"total": sum(vehicles.values()), "available": vehicles.get("available", 0), "out_of_service": blocked},
        "work_orders_open": {"total": sum(n for _, n in wos), "by_priority": {p: n for p, n in wos}},
        "defects_open": {"total": int(defects[0] or 0), "out_of_service": int(defects[1] or 0)},
        "drivers": {"total": len(drivers), "not_compliant": sum(1 for d in drivers if not d["compliant"]),
                    "no_wheelchair_runs": sum(1 for d in drivers if d["compliant"] and not d["wheelchair_ok"])},
        "runs_today": {"total": int(runs[0] or 0), "reassigned": int(runs[1] or 0), "running_late": int(runs[2] or 0)},
        "trips_today": {"total": sum(trips.values()), "booked": trips.get("booked", 0), "completed": trips.get("completed", 0),
                        "no_show": trips.get("no_show", 0)},
        "rider_messages_24h": messages,
        "on_time": otp,
    }


class BaselineIn(BaseModel):
    values: dict[str, float]
    notes: Optional[str] = None


@router.put("/baseline")
async def put_baseline(body: BaselineIn, s: SessionDep, user: User = Depends(require_roles("admin"))):
    bad = [k for k in body.values if k not in BASELINE_KEYS]
    if bad:
        raise HTTPException(400, f"Unknown measure(s): {', '.join(bad)}")
    if any(v < 0 for v in body.values.values()):
        raise HTTPException(400, "Baseline values must be zero or more.")
    b = await s.get(TenantBaseline, user.tenant_id) or TenantBaseline(tenant_id=user.tenant_id, values={})
    b.values = {**(b.values or {}), **body.values}
    b.source, b.notes, b.updated_by, b.updated_at = "entered", body.notes or "Entered from Phase 0 discovery", user.full_name, now()
    s.add(b)
    await s.commit()
    return await baseline_for(s, user.tenant_id)


@router.get("/system")
async def system_health(user: User = Depends(require_roles("admin"))):
    """Everything the Operations admin dashboard's "System health" panel needs that `/api/system/info` does not
    already carry: calls/errors/retries per connected product, this run. Composes existing config/adapter state
    rather than a new data source."""
    from app.adapters.resilience import adapter_stats
    from app.agents import AGENTS
    from app.core.config import settings
    from app.llm.router import llm

    return {"app": settings.app_name, "environment": settings.environment, "event_bus": settings.event_bus,
            "llm_provider": llm.primary.name, "adapter_mode": settings.adapter_mode, "audit_mirror": settings.audit_mirror,
            "database": "postgresql" if settings.is_postgres else "sqlite", "slm_provider": llm.slm.name,
            "auth_mode": settings.auth_mode, "eventbridge_inbound": bool(settings.eventbridge_sqs_queue_url),
            "agents": [a.describe() for a in AGENTS.values()], "live_connections": hub.connections,
            "adapters": adapter_stats()}


async def _measure_from_shadow(s, tenant_id: str) -> tuple[dict, int]:
    """What people did by hand in shadow-mode incidents: the agency's real way of working, measured."""
    from datetime import datetime as _dt

    rows = (await s.execute(select(Workflow).where(Workflow.tenant_id == tenant_id, Workflow.workflow_type == "vehicle_health",
                                                   Workflow.status == "shadow"))).scalars().all()
    sample = [w for w in rows if _manual_entries(w)]
    if not sample:
        return {}, 0
    to_wo = []
    covered, at_risk, returns = 0, 0, []
    for w in sample:
        entries = _manual_entries(w)
        wo = [e for e in entries if e["type"] == "workorder.created"]
        if wo and w.detected_at:
            to_wo.append((_dt.fromisoformat(wo[0]["at"]).replace(tzinfo=None) - w.detected_at).total_seconds() / 60)
        runs = {r["run_id"] for r in ((w.context or {}).get("assessment") or {}).get("runs_at_risk", [])}
        at_risk += len(runs)
        covered += len({e["data"].get("run_id") for e in entries if e["type"] == "run.reassigned"} & runs)
        returns.append(sum(1 for e in entries if e.get("step") == "return_to_service"))
    measured = {"manual_reentries_per_incident": round(sum(len(_manual_entries(w)) for w in sample) / len(sample), 1),
                "manual_steps_to_return": round(sum(returns) / len(returns), 1)}
    if to_wo:
        measured["detect_to_work_order_minutes"] = round(median(to_wo), 1)
    if at_risk:
        measured["runs_covered_pct"] = round(100 * covered / at_risk)
    return measured, len(sample)


@router.post("/baseline/measure")
async def measure_baseline(s: SessionDep, user: User = Depends(require_roles("admin"))):
    """Save the baseline measured from shadow mode, so it stays fixed as the comparison point."""
    measured, sample = await _measure_from_shadow(s, user.tenant_id)
    if not sample:
        raise HTTPException(400, "No shadow-mode incidents with manual actions yet. Run in shadow mode and let people handle a few incidents by hand.")
    b = await s.get(TenantBaseline, user.tenant_id) or TenantBaseline(tenant_id=user.tenant_id, values={})
    b.values = {**(b.values or {}), **measured}
    b.source, b.updated_by, b.updated_at = "measured_shadow", user.full_name, now()
    b.notes = f"Measured from {sample} shadow-mode incident(s) handled by hand."
    s.add(b)
    await s.commit()
    return {**(await baseline_for(s, user.tenant_id)), "measured": measured, "sample": sample}
