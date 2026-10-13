import re
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep
from app.api.serializers import row
from app.audit import service as audit
from app.embeddings import service as embeddings
from app.llm.router import llm
from app.models import AuditRecord, Workflow

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


HISTORY_TURNS = 5  # earlier questions (and answers) of the conversation used as context

# words that point back at something said earlier ("who approved it?", "when did that happen?")
FOLLOW_UP = re.compile(r"\b(it|its|it's|this|that|these|those|they|them|their|he|she|him|her|same|the vehicle|the bus|"
                       r"the van|the run|the work order|after that|before that)\b", re.I)
VEHICLE = re.compile(r"\b([VP]-\d{3})\b")


class Turn(BaseModel):
    question: str
    answer: str = ""
    workflow_id: Optional[str] = None


class AskIn(BaseModel):
    question: str
    workflow_id: Optional[str] = None
    history: list[Turn] = Field(default_factory=list)  # earlier turns of this conversation, oldest first


def _follow_up(question: str) -> bool:
    """A question that names no vehicle and refers back, or is too short to stand on its own."""
    return not VEHICLE.search(question.upper()) and (bool(FOLLOW_UP.search(question)) or len(question.split()) <= 5)


@router.post("/ask")
async def ask(body: AskIn, user: CurrentUser, s: SessionDep):
    wf = None
    if body.workflow_id:
        wf = await s.get(Workflow, body.workflow_id)
        if wf and wf.tenant_id != user.tenant_id:
            wf = None
    in_flow = wf is not None  # asked from a workflow's page: search only that flow's records
    history = body.history[-HISTORY_TURNS:]
    carried = None  # the workflow an earlier turn was about, when this question follows on from it
    if not wf:
        m = VEHICLE.search(body.question.upper())
        if m:
            wf = (await s.execute(select(Workflow).where(Workflow.tenant_id == user.tenant_id, Workflow.vehicle_label == m.group(1))
                                  .order_by(Workflow.started_at.desc()))).scalars().first()
        elif _follow_up(body.question):
            for t in reversed(history):
                if t.workflow_id and (c := await s.get(Workflow, t.workflow_id)) and c.tenant_id == user.tenant_id:
                    wf = carried = c
                    break
    # semantic search over the audit log (all-MiniLM-L6-v2 embeddings). A follow-up is searched together with the
    # question before it, and only within the workflow it follows on from, so "who approved it?" finds the right record.
    query = f"{history[-1].question} {body.question}" if carried and history else body.question
    hits = await embeddings.search(s, user.tenant_id, query, workflow_id=wf.id if (in_flow or carried) else None)
    if not wf and hits and hits[0]["workflow_id"]:  # no vehicle named: the best match's workflow is the one asked about
        wf = await s.get(Workflow, hits[0]["workflow_id"])
    ctx: dict = {"question": body.question, "retrieved": hits,
                 "history": [{"question": t.question, "answer": t.answer[:600]} for t in history]}
    if wf:
        recs = (await s.execute(select(AuditRecord).where(AuditRecord.workflow_id == wf.id).order_by(AuditRecord.created_at))).scalars().all()
        ctx["workflow"] = {k: v for k, v in row(wf, exclude=("context",)).items()}
        ctx["audit"] = [{"record_type": r.record_type, "step": r.step or "", "actor": r.actor, "human_action": r.human_action,
                         "outcome": r.outcome, "explanation": r.explanation, "created_at": r.created_at.isoformat()} for r in recs]
    res = await llm.run("assistant", ctx, tenant_id=user.tenant_id, workflow_id=wf.id if wf else None)
    await audit.record(s, tenant_id=user.tenant_id, workflow_id=wf.id if wf else None, record_type="assistant_answer", actor=user.full_name,
                       actor_type="human", data_considered={"question": body.question, "history_turns": len(history),
                                                            "follows_on_from": carried.id if carried else None,
                                                            "retrieved": [{"audit_id": h["audit_id"], "score": h["score"]} for h in hits]},
                       model_used=res.model, outcome="answered", explanation=res.text, input_tokens=res.input_tokens,
                       output_tokens=res.output_tokens)
    await s.commit()
    # show only the single best match: records of the same incident often score alike, and ties keep the first one
    return {"answer": res.text, "workflow_id": wf.id if wf else None, "vehicle_label": wf.vehicle_label if wf else None, "model": res.model,
            "sources": hits[:1], "context_turns": len(history), "follows_on_from": carried.vehicle_label if carried else None}
