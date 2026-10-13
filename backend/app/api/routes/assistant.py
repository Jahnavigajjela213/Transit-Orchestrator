import re
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep
from app.api.serializers import row
from app.audit import service as audit
from app.llm.router import llm
from app.models import AuditRecord, Workflow

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


class AskIn(BaseModel):
    question: str
    workflow_id: Optional[str] = None


@router.post("/ask")
async def ask(body: AskIn, user: CurrentUser, s: SessionDep):
    wf = None
    if body.workflow_id:
        wf = await s.get(Workflow, body.workflow_id)
        if wf and wf.tenant_id != user.tenant_id:
            wf = None
    if not wf:
        m = re.search(r"\b([VP]-\d{3})\b", body.question.upper())
        if m:
            wf = (await s.execute(select(Workflow).where(Workflow.tenant_id == user.tenant_id, Workflow.vehicle_label == m.group(1))
                                  .order_by(Workflow.started_at.desc()))).scalars().first()
    ctx: dict = {"question": body.question}
    if wf:
        recs = (await s.execute(select(AuditRecord).where(AuditRecord.workflow_id == wf.id).order_by(AuditRecord.created_at))).scalars().all()
        ctx["workflow"] = {k: v for k, v in row(wf, exclude=("context",)).items()}
        ctx["audit"] = [{"record_type": r.record_type, "step": r.step or "", "actor": r.actor, "human_action": r.human_action,
                         "outcome": r.outcome, "explanation": r.explanation, "created_at": r.created_at.isoformat()} for r in recs]
    res = await llm.run("assistant", ctx, tenant_id=user.tenant_id, workflow_id=wf.id if wf else None)
    await audit.record(s, tenant_id=user.tenant_id, workflow_id=wf.id if wf else None, record_type="assistant_answer", actor=user.full_name,
                       actor_type="human", data_considered={"question": body.question}, model_used=res.model, outcome="answered",
                       explanation=res.text, input_tokens=res.input_tokens, output_tokens=res.output_tokens)
    await s.commit()
    return {"answer": res.text, "workflow_id": wf.id if wf else None, "vehicle_label": wf.vehicle_label if wf else None, "model": res.model}
