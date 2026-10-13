"""Human decisions on Needs Your Attention items."""
from typing import Any, Optional

from app.audit import service as audit
from app.core.clock import now
from app.core.database import session_scope
from app.core.event_bus import bus
from app.core.events import CloudEvent, EventTypes
from app.core.realtime import hub
from app.models import ApprovalRequest, User, Workflow

DECISIONS = {"approve": "approved", "reject": "rejected", "override": "overridden", "acknowledge": "acknowledged"}


class DecisionError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _validate_override(ar: ApprovalRequest, override: dict) -> dict:
    if ar.step == "reassign_runs":
        per_run = ar.options.get("per_run", {})
        clean = []
        for a in override.get("assignments", []):
            opts = per_run.get(a.get("run_id"))
            if opts is None:
                raise DecisionError(400, f"Run {a.get('run_id')} is not part of this plan.")
            if a.get("vehicle_id") and a["vehicle_id"] not in {v["vehicle_id"] for v in opts["vehicles"]}:
                raise DecisionError(400, f"That vehicle did not pass the checks for {a['run_id']}.")
            if a.get("driver_id") and a["driver_id"] not in {d["driver_id"] for d in opts["drivers"]}:
                raise DecisionError(400, f"That driver is not qualified or available for {a['run_id']}.")
            clean.append({k: a.get(k) for k in ("run_id", "vehicle_id", "driver_id")})
        return {"assignments": clean}
    if ar.step == "open_work_order":
        out = {k: override[k] for k in ("shop_start", "shop_end", "priority") if override.get(k)}
        if out.get("priority") and out["priority"] not in ("critical", "high", "medium", "low"):
            raise DecisionError(400, "Priority must be critical, high, medium or low.")
        if out.get("shop_start") and out.get("shop_end") and out["shop_end"] <= out["shop_start"]:
            raise DecisionError(400, "Shop end must be after shop start.")
        return out
    if ar.step == "pull_vehicle":
        out = {k: override[k] for k in ("from", "until") if override.get(k)}
        if out.get("from") and out.get("until") and out["until"] <= out["from"]:
            raise DecisionError(400, "The end of the unavailable window must be after its start.")
        return out
    if ar.step == "adjust_schedule":
        mode = override.get("mode")
        if mode not in (ar.options.get("modes") or []):
            raise DecisionError(400, "Choose one of the offered options: " + ", ".join(ar.options.get("modes") or []) + ".")
        out = {"mode": mode}
        if mode == "insert":
            rid = override.get("request_id") or (ar.recommendation.get("candidate") or {}).get("request_id")
            if rid not in {c["request_id"] for c in ar.options.get("candidates", [])}:
                raise DecisionError(400, "That standby rider did not pass the seat, wheelchair or timing checks.")
            out["request_id"] = rid
        return out
    raise DecisionError(400, "This step cannot be changed, only approved or rejected.")


async def decide(user: User, approval_id: str, action: str, note: Optional[str] = None, override: Optional[dict[str, Any]] = None,
                 wait: bool = True) -> dict:
    if action not in DECISIONS:
        raise DecisionError(400, "Action must be approve, reject, override or acknowledge.")
    async with session_scope() as s:
        ar = await s.get(ApprovalRequest, approval_id)
        if not ar or ar.tenant_id != user.tenant_id:
            raise DecisionError(404, "This item no longer exists.")
        if ar.status != "pending":
            raise DecisionError(409, f"Already {ar.status} by {ar.decided_by_name or 'someone else'}.")
        wf = await s.get(Workflow, ar.workflow_id)
        if ar.kind in ("escalation", "informational"):
            if action != "acknowledge":
                raise DecisionError(400, "This item can only be acknowledged.")
            ar.status, ar.decided_at, ar.decided_by, ar.decided_by_name, ar.decision_note = "acknowledged", now(), user.id, user.full_name, note
            await audit.record(s, tenant_id=user.tenant_id, workflow_id=ar.workflow_id, step=ar.step, record_type="human_action",
                               actor=user.full_name, actor_type="human", human_action="acknowledged", outcome="acknowledged",
                               explanation=note or "", trace_id=wf.trace_id if wf else None)
            hub.publish(user.tenant_id, "approval", {"id": ar.id, "status": ar.status})
            return {"approval_id": ar.id, "status": ar.status}
        if action == "acknowledge":
            raise DecisionError(400, "Approve, reject or change this item.")
        if user.role != "admin" and user.role not in ar.approver_roles:
            raise DecisionError(403, f"Only {' or '.join(r.replace('_', ' ') for r in ar.approver_roles)} can decide this step.")
        clean_override = _validate_override(ar, override or {}) if action == "override" else None
        ar.status = DECISIONS[action]
        ar.decided_at, ar.decided_by, ar.decided_by_name = now(), user.id, user.full_name
        ar.decision_note, ar.override_payload = note, clean_override
        wf.human_touches += 1
        await audit.record(s, tenant_id=user.tenant_id, workflow_id=ar.workflow_id, step=ar.step, record_type="human_action",
                           actor=user.full_name, actor_type="human", autonomy_level="semi_autonomous", human_action=ar.status,
                           recommendation=ar.recommendation, data_considered={"override": clean_override} if clean_override else {},
                           outcome=ar.status, explanation=note or "", trace_id=wf.trace_id, triggering_event_id=wf.trigger_event_id)
        payload = {"approval_id": ar.id, "workflow_id": ar.workflow_id, "step": ar.step, "decision": ar.status, "actor": user.full_name,
                   "actor_id": user.id, "role": user.role, "note": note, "override": clean_override}
        tenant_id = user.tenant_id
    hub.publish(tenant_id, "approval", {"id": approval_id, "status": DECISIONS[action]})
    ev = CloudEvent(type=EventTypes.APPROVAL_DECIDED, source="orchestrator", tenantid=tenant_id, correlationid=payload["workflow_id"], data=payload)
    await bus.publish(ev)
    processed = await bus.wait_processed(ev.id, timeout=30) if wait else None
    return {"approval_id": approval_id, "status": DECISIONS[action], "processing": processed or "queued"}
