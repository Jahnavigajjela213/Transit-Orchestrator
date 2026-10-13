"""Shadow mode: what the agent would have done next to what people actually did."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep, require_roles
from app.core.clock import now
from app.models import ShadowRecommendation, User, Workflow
from app.orchestrator import shadow

router = APIRouter(prefix="/api/shadow", tags=["shadow mode"])


@router.get("")
async def list_shadow(user: CurrentUser, s: SessionDep, status: Optional[str] = None, limit: int = 200):
    await shadow.expire_unmatched(user.tenant_id)
    q = select(ShadowRecommendation).where(ShadowRecommendation.tenant_id == user.tenant_id)
    if status:
        q = q.where(ShadowRecommendation.status.in_(status.split(",")))
    rows = (await s.execute(q.order_by(ShadowRecommendation.recommended_at.desc()).limit(limit))).scalars().all()
    wfs = {w.id: w for w in (await s.execute(select(Workflow).where(Workflow.id.in_({r.workflow_id for r in rows})))).scalars()} if rows else {}
    return [shadow.to_dict(r, wfs.get(r.workflow_id)) for r in rows]


@router.get("/summary")
async def summary(user: CurrentUser, s: SessionDep):
    await shadow.expire_unmatched(user.tenant_id)
    return await shadow.summary(s, user.tenant_id)


class ReviewIn(BaseModel):
    verdict: str  # agent_better | human_better | same
    note: Optional[str] = None


@router.post("/{rec_id}/review")
async def review(rec_id: str, body: ReviewIn, s: SessionDep, user: User = Depends(require_roles("dispatcher", "shop_manager"))):
    if body.verdict not in ("agent_better", "human_better", "same"):
        raise HTTPException(400, "Verdict must be agent_better, human_better or same.")
    r = await s.get(ShadowRecommendation, rec_id)
    if not r or r.tenant_id != user.tenant_id:
        raise HTTPException(404, "Not found.")
    r.verdict, r.review_note, r.reviewed_by, r.reviewed_at = body.verdict, body.note, user.full_name, now()
    await s.commit()
    return shadow.to_dict(r)
