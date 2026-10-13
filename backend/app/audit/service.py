"""Writes decision records. Every event, decision, approval, and action goes through here."""
import json
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.sinks import mirror
from app.core.clock import new_id, precise_now
from app.core.realtime import hub
from app.models import AuditOutbox, AuditRecord

REQUIRED_FIELDS_BY_TYPE = {
    "assessment": ("triggering_event_id", "data_considered", "recommendation", "explanation"),
    "decision": ("autonomy_level", "recommendation", "explanation"),
    "human_action": ("human_action", "actor"),
    "action_executed": ("outcome",),
}


async def record(
    s: AsyncSession,
    *,
    tenant_id: str,
    record_type: str,
    workflow_id: Optional[str] = None,
    step: Optional[str] = None,
    triggering_event_id: Optional[str] = None,
    actor: str = "orchestrator-agent",
    actor_type: str = "agent",
    autonomy_level: Optional[str] = None,
    data_considered: Optional[dict[str, Any]] = None,
    model_used: Optional[str] = None,
    recommendation: Optional[dict[str, Any]] = None,
    human_action: Optional[str] = None,
    outcome: Optional[str] = None,
    explanation: str = "",
    trace_id: Optional[str] = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
) -> AuditRecord:
    rec = AuditRecord(
        id=new_id("aud"), tenant_id=tenant_id, workflow_id=workflow_id, step=step, record_type=record_type,
        triggering_event_id=triggering_event_id, actor=actor, actor_type=actor_type, autonomy_level=autonomy_level,
        data_considered=data_considered or {}, model_used=model_used, recommendation=recommendation or {},
        human_action=human_action, outcome=outcome, explanation=explanation, trace_id=trace_id,
        input_tokens=input_tokens, output_tokens=output_tokens, created_at=precise_now(),
    )
    s.add(rec)
    await s.flush()
    if mirror.enabled:  # same transaction as the record: shipped to the mirror by audit/shipper.py, with retries
        s.add(AuditOutbox(id=rec.id, tenant_id=tenant_id, payload=json.loads(json.dumps(to_dict(rec), default=str)), status="pending",
                          created_at=rec.created_at, next_attempt_at=rec.created_at))
    hub.publish(tenant_id, "audit", {"id": rec.id, "workflow_id": workflow_id, "record_type": record_type, "step": step})
    return rec


def to_dict(rec: AuditRecord) -> dict[str, Any]:
    return {c.name: getattr(rec, c.name) for c in AuditRecord.__table__.columns}


def is_complete(rec: AuditRecord) -> bool:
    for field in REQUIRED_FIELDS_BY_TYPE.get(rec.record_type, ()):
        if getattr(rec, field) in (None, "", {}, []):
            return False
    return True
