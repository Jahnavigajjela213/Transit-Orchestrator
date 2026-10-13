from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep
from app.api.serializers import row
from app.models import ApprovalRequest
from app.orchestrator.approvals import DecisionError, decide

router = APIRouter(prefix="/api/approvals", tags=["needs your attention"])


@router.get("")
async def list_approvals(user: CurrentUser, s: SessionDep, status: Optional[str] = "pending", limit: int = 100):
    q = select(ApprovalRequest).where(ApprovalRequest.tenant_id == user.tenant_id)
    if status:
        q = q.where(ApprovalRequest.status.in_(status.split(",")))
    rows = (await s.execute(q.order_by(ApprovalRequest.requested_at.desc()).limit(limit))).scalars()
    out = []
    for a in rows:
        d = row(a)
        d["can_decide"] = user.role == "admin" or user.role in (a.approver_roles or [])
        out.append(d)
    return out


@router.get("/{approval_id}")
async def get_approval(approval_id: str, user: CurrentUser, s: SessionDep):
    a = await s.get(ApprovalRequest, approval_id)
    if not a or a.tenant_id != user.tenant_id:
        raise HTTPException(404, "This item no longer exists.")
    return {**row(a), "can_decide": user.role == "admin" or user.role in (a.approver_roles or [])}


class DecisionIn(BaseModel):
    action: str  # approve | reject | override | acknowledge
    note: Optional[str] = None
    override: Optional[dict[str, Any]] = None


@router.post("/{approval_id}/decision")
async def make_decision(approval_id: str, body: DecisionIn, user: CurrentUser):
    try:
        return await decide(user, approval_id, body.action, body.note, body.override)
    except DecisionError as e:
        raise HTTPException(e.status, e.message)
