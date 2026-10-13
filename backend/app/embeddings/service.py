"""Embeddings of the audit log (all-MiniLM-L6-v2) and semantic search over them for the assistant.

A background job embeds every new audit record into audit_embeddings: one normalized 384-dim vector per record, built from
a plain-text rendering of the record (vehicle, step, who, what, outcome, explanation). The Databricks sync copies the table
like the others. A question is embedded the same way and ranked against a tenant's vectors (or one workflow's) by cosine
similarity; the best matches are handed to the assistant as the records most relevant to the question.
Assistant answers themselves are not embedded, so the assistant never cites its own earlier answers as evidence.
"""
import asyncio
import threading
from typing import Optional

import numpy as np
from sqlalchemy import select

from app.core.config import settings
from app.core.database import session_scope
from app.core.logging import get_logger
from app.models import AuditEmbedding, AuditRecord, Workflow

log = get_logger("embeddings")
SKIP_TYPES = ("assistant_answer",)
BATCH = 64

_model = None
_model_lock = threading.Lock()


def _load():
    global _model
    with _model_lock:
        if _model is None:
            from sentence_transformers import SentenceTransformer

            _model = SentenceTransformer(settings.embedding_model, device="cpu")
            log.info("Embedding model %s loaded", settings.embedding_model)
    return _model


async def embed(texts: list[str]) -> np.ndarray:
    """Normalized embeddings (rows), so a dot product is the cosine similarity."""
    def run():
        return _load().encode(texts, normalize_embeddings=True, batch_size=32, show_progress_bar=False)

    return await asyncio.to_thread(run)


# what each workflow step does, phrased to follow "to ..."
STEPS = {
    "detect": "detect the problem", "assess": "assess the problem", "open_work_order": "open a work order",
    "pull_vehicle": "take the vehicle out of service", "reassign_runs": "cover the affected runs with a spare vehicle and driver",
    "notify_riders": "notify the affected riders", "return_to_service": "return the vehicle to service",
}


def _words(v: Optional[str]) -> str:
    return (v or "").replace("_", " ").replace(".", " ").strip()


PRODUCTS = {"asset_mgmt": "asset management", "trip_mgmt": "trip management", "rider_comms": "rider communications"}


def _who(r: AuditRecord) -> str:
    if r.actor_type == "human" or r.actor != r.actor.lower():  # a person's name (also when they acted inside a product)
        return r.actor
    name = PRODUCTS.get(r.actor, _words(r.actor).replace("-", " "))
    return f"the {name}" + ("" if r.actor_type == "agent" else " system")


def _sentence(t: str) -> str:
    t = (t or "").strip()
    return t if not t or t.endswith((".", "!", "?")) else t + "."


def audit_text(r: AuditRecord, wf: Optional[Workflow]) -> str:
    """An audit record told as a short story in plain sentences. It is what search compares a question against, and what
    the assistant shows as its source."""
    when = f"On {r.created_at:%a %d %b} at {r.created_at:%H:%M}"
    if wf:
        label, _, issue = wf.title.partition(": ")
        issue = issue if issue[1:2].isupper() else issue[:1].lower() + issue[1:]  # keep acronyms like "ABS"
        about = f"{label} ({issue})" if issue else wf.title
        flow = f"the {_words(wf.workflow_type)} orchestration for {about}"
    else:
        flow = "the orchestrator"
    who, step = _who(r), STEPS.get(r.step or "", _words(r.step))
    kind = r.record_type
    if kind == "event_received":
        story = (f"{when}, {who} reported that the work order was closed, so {flow} moved to return the vehicle to service"
                 if r.step == "return_to_service" else f"{when}, {who} reported a problem, which started {flow}")
    elif kind == "assessment":
        story = f"{when}, {who} assessed the situation in {flow}"
    elif kind == "approval_requested":
        story = f"{when}, in {flow}, {who} asked for a person's approval to {step}"
    elif kind == "human_action":
        verb = {"approved": "approved", "rejected": "rejected", "edited": "edited and approved"}.get(r.human_action or "", _words(r.human_action) or "acted on")
        story = f"{when}, {who} {verb} the request to {step} in {flow}"
    elif kind == "decision":
        story = (f"{when}, in {flow}, {who} went ahead with the step to {step} on its own, because the autonomy policy "
                 f"does not require approval for it" if r.outcome == "auto_approved" else f"{when}, in {flow}, {who} decided how to {step}")
    elif kind == "action_executed":
        story = f"{when}, in {flow}, {who} carried out the step to {step}"
    elif kind == "shadow_recommendation":
        story = (f"{when}, {flow} was running in shadow mode, so {who} only wrote down that it would {step}; "
                 f"nothing was changed in the products")
    elif kind == "policy_change":
        story = f"{when}, {who} changed the autonomy policy" + (f", which is now {r.outcome}" if r.outcome else "")
    elif kind == "workflow_status":
        story = f"{when}, {flow} " + ("finished in shadow mode, without changing anything in the products"
                                      if r.outcome == "shadow" else f"was {_words(r.outcome)}")
    else:
        story = f"{when}, {who} recorded a {_words(kind)} in {flow}"
    story = _sentence(story[0].upper() + story[1:])
    # these explanations only repeat the story above in system terms ("vehicle.fault.detected ... vehicle_health")
    detail = "" if kind in ("workflow_status", "policy_change") or (kind == "event_received" and r.step == "detect") else r.explanation
    return f"{story} {_sentence(detail)}".strip()


async def embed_pending() -> int:
    """Embed audit records that have no embedding yet. Returns how many were embedded."""
    async with session_scope() as s:
        recs = (await s.execute(select(AuditRecord).outerjoin(AuditEmbedding, AuditEmbedding.audit_id == AuditRecord.id)
                                .where(AuditEmbedding.audit_id.is_(None), AuditRecord.record_type.notin_(SKIP_TYPES))
                                .order_by(AuditRecord.created_at).limit(BATCH))).scalars().all()
        if not recs:
            return 0
        wf_ids = {r.workflow_id for r in recs if r.workflow_id}
        wfs = {w.id: w for w in (await s.execute(select(Workflow).where(Workflow.id.in_(wf_ids)))).scalars()} if wf_ids else {}
        texts = [audit_text(r, wfs.get(r.workflow_id)) for r in recs]
        vectors = await embed(texts)
        for r, t, v in zip(recs, texts, vectors):
            s.add(AuditEmbedding(audit_id=r.id, tenant_id=r.tenant_id, workflow_id=r.workflow_id, record_type=r.record_type, text=t,
                                 model=settings.embedding_model, dims=len(v), embedding=[round(float(x), 6) for x in v]))
    return len(recs)


async def search(s, tenant_id: str, question: str, workflow_id: Optional[str] = None, k: Optional[int] = None) -> list[dict]:
    """Audit records most similar in meaning to the question, best first. `s` may be the request's session, so with
    READ_SOURCE=databricks the vectors are read from Databricks.

    The same thing is often recorded more than once (a vehicle that had several orchestrations, a record entered twice).
    Only the latest entry of each kind is kept: same vehicle (or workflow), record type, step and actor. So answers always
    come from the most recent data about what was asked, never from an older copy."""
    if not settings.embeddings_enabled:
        return []
    q = (select(AuditEmbedding.audit_id, AuditEmbedding.workflow_id, AuditEmbedding.record_type, AuditEmbedding.text,
                AuditEmbedding.embedding, AuditRecord.step, AuditRecord.actor, AuditRecord.created_at)
         .join(AuditRecord, AuditRecord.id == AuditEmbedding.audit_id).where(AuditEmbedding.tenant_id == tenant_id))
    if workflow_id:
        q = q.where(AuditEmbedding.workflow_id == workflow_id)
    rows = (await s.execute(q)).all()
    if not rows:
        return []
    wf_ids = {r.workflow_id for r in rows if r.workflow_id}
    vehicle = dict((await s.execute(select(Workflow.id, Workflow.vehicle_label).where(Workflow.id.in_(wf_ids)))).all()) if wf_ids else {}

    latest: dict[tuple, int] = {}  # kind of entry -> index of its newest row
    for i, r in enumerate(rows):
        key = (vehicle.get(r.workflow_id) or r.workflow_id, r.record_type, r.step, r.actor)
        if key not in latest or r.created_at > rows[latest[key]].created_at:
            latest[key] = i
    keep = sorted(latest.values())

    vecs = np.asarray([rows[i].embedding for i in keep], dtype=np.float32)
    scores = vecs @ (await embed([question]))[0]
    # best match first; on equal scores the newer entry wins
    order = sorted(range(len(keep)), key=lambda j: (-round(float(scores[j]), 3), -rows[keep[j]].created_at.timestamp()))
    best = [j for j in order[: k or settings.assistant_top_k] if scores[j] >= settings.assistant_min_score]
    return [{"audit_id": rows[keep[j]].audit_id, "workflow_id": rows[keep[j]].workflow_id, "record_type": rows[keep[j]].record_type,
             "text": rows[keep[j]].text, "score": round(float(scores[j]), 3), "recorded_at": rows[keep[j]].created_at.isoformat()}
            for j in best]


class AuditEmbedder:
    def __init__(self) -> None:
        self._task: Optional[asyncio.Task] = None

    def start(self) -> None:
        if settings.embeddings_enabled and not self._task:
            self._task = asyncio.create_task(self._loop(), name="audit-embedder")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None

    async def _loop(self) -> None:
        while True:
            try:
                while (n := await embed_pending()):
                    log.info("Embedded %d audit record(s)", n)
            except Exception as e:  # noqa: BLE001
                log.warning("Audit embedding failed, will retry: %s", e)
            await asyncio.sleep(settings.embedding_interval_seconds)


embedder = AuditEmbedder()
