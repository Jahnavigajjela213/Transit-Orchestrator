"""Success measures from the proposal, computed live from workflows and the audit log."""
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

# Placeholder until Phase 0: an admin can type the discovery numbers in, or measure them from shadow mode.
DEFAULT_BASELINE = {"detect_to_work_order_minutes": 190, "manual_reentries_per_incident": 6, "runs_covered_pct": 71,
                    "audit_complete_pct": 35, "manual_steps_to_return": 3}
BASELINE_KEYS = tuple(DEFAULT_BASELINE)
READY_MIN_DECISIONS = 10
READY_MIN_ACCEPTANCE = 90


async def baseline_for(s, tenant_id: str) -> dict:
    b = await s.get(TenantBaseline, tenant_id)
    if not b:
        return {"values": DEFAULT_BASELINE, "source": "default", "notes": "Synthetic placeholder until the Phase 0 baseline is entered or measured.",
                "updated_by": None, "updated_at": None}
    return {"values": {**DEFAULT_BASELINE, **(b.values or {})}, "source": b.source, "notes": b.notes, "updated_by": b.updated_by,
            "updated_at": b.updated_at}


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
        for step, cfg in rules["steps"].items():
            if cfg.get("level") != "semi_autonomous":
                continue
            recent = [x for x in hist if x[0] == step and x[2] >= now() - timedelta(days=28)]
            n = len(recent)
            ok = sum(1 for x in recent if x[1] == "approved")
            pct = round(100 * ok / n) if n else None
            readiness.append({"workflow_type": wtype, "step": step, "decisions_28d": n, "acceptance_pct": pct,
                              "ready": n >= READY_MIN_DECISIONS and (pct or 0) >= READY_MIN_ACCEPTANCE,
                              "rule": f"{READY_MIN_DECISIONS}+ decisions in 28 days with {READY_MIN_ACCEPTANCE}%+ approved unchanged"})
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


@router.get("/baseline")
async def get_baseline(user: CurrentUser, s: SessionDep):
    return await baseline_for(s, user.tenant_id)


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


@router.post("/baseline/measure")
async def measure_baseline(s: SessionDep, user: User = Depends(require_roles("admin"))):
    """Phase 0 baseline measured from shadow mode: what people actually did, by hand, for the same incidents."""
    rows = (await s.execute(select(Workflow).where(Workflow.tenant_id == user.tenant_id, Workflow.workflow_type == "vehicle_health",
                                                   Workflow.status == "shadow"))).scalars().all()
    sample = [w for w in rows if _manual_entries(w)]
    if not sample:
        raise HTTPException(400, "No shadow-mode incidents with manual actions yet. Run in shadow mode and let people handle a few incidents by hand.")
    to_wo = []
    covered, at_risk, returns = 0, 0, []
    for w in sample:
        entries = _manual_entries(w)
        wo = [e for e in entries if e["type"] == "workorder.created"]
        if wo:
            from datetime import datetime as _dt

            to_wo.append((_dt.fromisoformat(wo[0]["at"]) - w.detected_at).total_seconds() / 60)
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
    b = await s.get(TenantBaseline, user.tenant_id) or TenantBaseline(tenant_id=user.tenant_id, values={})
    b.values = {**(b.values or {}), **measured}
    b.source, b.updated_by, b.updated_at = "measured_shadow", user.full_name, now()
    b.notes = f"Measured from {len(sample)} shadow-mode incident(s) handled by hand."
    s.add(b)
    await s.commit()
    return {**(await baseline_for(s, user.tenant_id)), "measured": measured, "sample": len(sample)}
