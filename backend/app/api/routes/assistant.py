import re
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select

from app.api.deps import CurrentUser, SessionDep
from app.api.serializers import row
from app.audit import service as audit
from app.embeddings import service as embeddings
from app.core.clock import new_id, now
from app.llm.router import llm
from app.models import AssistantMessage, AssistantSession, AuditRecord, Workflow

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
    history: list[Turn] = Field(default_factory=list)  # earlier turns, oldest first (when the chat is not saved)
    session_id: Optional[str] = None  # a saved chat to continue: its own earlier turns are used as context
    new_session: bool = False  # start a saved chat with this question


async def _own_session(s, user, session_id: str) -> AssistantSession:
    chat = await s.get(AssistantSession, session_id)
    if not chat or chat.user_id != user.id:
        raise HTTPException(404, "That chat no longer exists.")
    return chat


async def _messages(s, session_id: str) -> list[AssistantMessage]:
    return list((await s.execute(select(AssistantMessage).where(AssistantMessage.session_id == session_id)
                                 .order_by(AssistantMessage.created_at, AssistantMessage.id))).scalars())


def _turns(msgs: list[AssistantMessage]) -> list[Turn]:
    """Question/answer pairs of a saved chat, oldest first."""
    return [Turn(question=q.text, answer=a.text, workflow_id=(a.meta or {}).get("workflow_id"))
            for q, a in zip(msgs, msgs[1:]) if q.role == "you" and a.role == "assistant"]


def _message_out(m: AssistantMessage) -> dict:
    return {"id": m.id, "role": m.role, "text": m.text, "created_at": m.created_at.isoformat(), **(m.meta or {})}


# ---------------------------------------------------------------- saved chats
@router.get("/sessions")
async def sessions(user: CurrentUser, s: SessionDep):
    """The signed-in user's chats, most recently used first."""
    counts = (select(AssistantMessage.session_id, func.count().label("n")).group_by(AssistantMessage.session_id).subquery())
    rows = (await s.execute(select(AssistantSession, counts.c.n).outerjoin(counts, counts.c.session_id == AssistantSession.id)
                            .where(AssistantSession.user_id == user.id).order_by(AssistantSession.updated_at.desc()))).all()
    return [{"id": c.id, "title": c.title, "created_at": c.created_at.isoformat(), "updated_at": c.updated_at.isoformat(),
             "messages": n or 0} for c, n in rows]


@router.get("/sessions/{session_id}")
async def session_detail(session_id: str, user: CurrentUser, s: SessionDep):
    chat = await _own_session(s, user, session_id)
    return {"id": chat.id, "title": chat.title, "messages": [_message_out(m) for m in await _messages(s, chat.id)]}


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, user: CurrentUser, s: SessionDep):
    chat = await _own_session(s, user, session_id)
    await s.execute(delete(AssistantMessage).where(AssistantMessage.session_id == chat.id))
    await s.delete(chat)
    await s.commit()
    return {"deleted": session_id}


def _follow_up(question: str) -> bool:
    """A question that names no vehicle and refers back, or is too short to stand on its own."""
    return not VEHICLE.search(question.upper()) and (bool(FOLLOW_UP.search(question)) or len(question.split()) <= 5)


# Words that tie a question to one step of the vehicle-health flow, so a question about a step that has not happened yet
# is answered as "not yet" rather than "not in the audit log".
STEP_WORDS = [("open_work_order", r"work order|repair job|faster"), ("pull_vehicle", r"\bpull|off the road|unavailable|block"),
              ("reassign_runs", r"driver|spare|reassign|cover|ruled out"), ("notify_riders", r"rider|notif|message|told|eta"),
              ("return_to_service", r"return|back (in|on|to)|closed")]


def _asked_step(question: str, steps: list[dict]) -> Optional[dict]:
    """The step the question is about, with its number and state, when it can be told from the wording."""
    for key, pattern in STEP_WORDS:
        if re.search(pattern, question, re.I):
            for i, x in enumerate(steps, 1):
                if x.get("key") == key:
                    return {"n": i, "label": x.get("label") or key, "status": x.get("status")}
    return None


@router.post("/ask")
async def ask(body: AskIn, user: CurrentUser, s: SessionDep):
    chat = None
    history = body.history
    if body.session_id:
        chat = await _own_session(s, user, body.session_id)
        history = _turns(await _messages(s, chat.id))
    elif body.new_session:
        title = " ".join(body.question.split())
        chat = AssistantSession(id=new_id("chat"), tenant_id=user.tenant_id, user_id=user.id,
                                title=title if len(title) <= 80 else title[:77].rsplit(" ", 1)[0] + "...")
        s.add(chat)
        await s.flush()  # the chat row must exist before its first message
    if chat:  # save the question now, so it is there even if the user leaves the page before the answer arrives
        chat.updated_at = now()
        s.add(AssistantMessage(id=new_id("msg"), session_id=chat.id, role="you", text=body.question.strip(), meta={}))
        await s.commit()

    wf = None
    if body.workflow_id:
        wf = await s.get(Workflow, body.workflow_id)
        if wf and wf.tenant_id != user.tenant_id:
            wf = None
    in_flow = wf is not None  # asked from a workflow's page: search only that flow's records
    history = history[-HISTORY_TURNS:]
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
        # the assistant's own earlier answers are not facts about the orchestration: leave them out of its timeline
        recs = (await s.execute(select(AuditRecord).where(AuditRecord.workflow_id == wf.id, AuditRecord.record_type != "assistant_answer")
                                .order_by(AuditRecord.created_at))).scalars().all()
        ctx["workflow"] = {k: v for k, v in row(wf, exclude=("context",)).items()}
        ctx["asked_step"] = _asked_step(body.question, wf.steps or [])
        ctx["audit"] = [{"record_type": r.record_type, "step": r.step or "", "actor": r.actor, "human_action": r.human_action,
                         "outcome": r.outcome, "explanation": r.explanation, "created_at": r.created_at.isoformat()} for r in recs]
    res = await llm.run("assistant", ctx, tenant_id=user.tenant_id, workflow_id=wf.id if wf else None)
    await audit.record(s, tenant_id=user.tenant_id, workflow_id=wf.id if wf else None, record_type="assistant_answer", actor=user.full_name,
                       actor_type="human", data_considered={"question": body.question, "history_turns": len(history),
                                                            "follows_on_from": carried.id if carried else None,
                                                            "retrieved": [{"audit_id": h["audit_id"], "score": h["score"]} for h in hits]},
                       model_used=res.model, outcome="answered", explanation=res.text, input_tokens=res.input_tokens,
                       output_tokens=res.output_tokens)
    # show only the single best match: records of the same incident often score alike, and ties keep the first one
    meta = {"workflow_id": wf.id if wf else None, "vehicle_label": wf.vehicle_label if wf else None, "model": res.model,
            "sources": hits[:1], "context_turns": len(history), "follows_on_from": carried.vehicle_label if carried else None}
    if chat:
        chat.updated_at = now()
        s.add(AssistantMessage(id=new_id("msg"), session_id=chat.id, role="assistant", text=res.text, meta=meta))
    await s.commit()
    return {"answer": res.text, **meta, "session_id": chat.id if chat else None, "session_title": chat.title if chat else None}
