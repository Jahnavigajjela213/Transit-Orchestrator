from typing import Optional

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select

from app.api.deps import CurrentUser, SessionDep
from app.api.serializers import row
from app.core.database import SessionLocal
from app.models import ApprovalRequest, AuditRecord, EventRecord, Notification, Rider, ShadowRecommendation, Workflow, WorkOrder
from app.orchestrator import shadow
from app.orchestrator.service import orchestrator

router = APIRouter(prefix="/api/workflows", tags=["workflows"])


@router.get("")
async def list_workflows(user: CurrentUser, s: SessionDep, status: Optional[str] = None, vehicle: Optional[str] = None,
                         workflow_type: Optional[str] = None, limit: int = 100):
    q = select(Workflow).where(Workflow.tenant_id == user.tenant_id)
    if workflow_type:
        q = q.where(Workflow.workflow_type == workflow_type)
    if status:
        q = q.where(Workflow.status.in_(status.split(",")))
    if vehicle:
        q = q.where(Workflow.vehicle_label == vehicle)
    rows = (await s.execute(q.order_by(Workflow.started_at.desc()).limit(limit))).scalars()
    return [row(w, exclude=("context",)) for w in rows]


@router.get("/{workflow_id}")
async def get_workflow(workflow_id: str, user: CurrentUser, s: SessionDep):
    wf = await s.get(Workflow, workflow_id)
    if not wf or wf.tenant_id != user.tenant_id:
        raise HTTPException(404, "Workflow not found.")
    approvals = (await s.execute(select(ApprovalRequest).where(ApprovalRequest.workflow_id == wf.id).order_by(ApprovalRequest.requested_at))).scalars()
    audit = (await s.execute(select(AuditRecord).where(AuditRecord.workflow_id == wf.id).order_by(AuditRecord.created_at, AuditRecord.id))).scalars()
    notif_count = (await s.execute(select(func.count()).select_from(Notification).where(Notification.workflow_id == wf.id))).scalar_one()
    notes = (await s.execute(select(Notification, Rider).join(Rider, Rider.id == Notification.rider_id)
                             .where(Notification.workflow_id == wf.id).order_by(Notification.created_at).limit(50))).all()
    trigger = await s.get(EventRecord, wf.trigger_event_id)
    cp = await orchestrator.checkpoint_state(wf.id)
    shadows = (await s.execute(select(ShadowRecommendation).where(ShadowRecommendation.workflow_id == wf.id)
                               .order_by(ShadowRecommendation.recommended_at))).scalars()
    # The shop acts on this work order from this page, so its status comes from the system of record (Postgres), not the
    # Databricks copy, which trails it by several seconds and would make Start / Close look like they did nothing.
    wo_ref = (cp["values"].get("work_order") or {}).get("work_order_id")
    wo_status = None
    if wo_ref:
        async with SessionLocal() as pg:
            live = await pg.get(WorkOrder, wo_ref)
            wo_status = live.status if live and live.tenant_id == user.tenant_id else None
    return {
        **row(wf),
        "approvals": [{**row(a), "can_decide": user.role == "admin" or user.role in (a.approver_roles or [])} for a in approvals],
        "audit": [row(a) for a in audit],
        "notification_count": notif_count,
        "notifications": [{**row(n), "rider_name": r.name, "language": r.language} for n, r in notes],
        "trigger_event": row(trigger) if trigger else None,
        "checkpoint": {"next": cp["next"], "pending": cp["pending"],
                       "work_order": cp["values"].get("work_order"), "assignments": cp["values"].get("assignments"),
                       "compensation": cp["values"].get("compensation"), "failure": cp["values"].get("failure"),
                       "notifications": cp["values"].get("notifications"), "adjustment": cp["values"].get("adjustment"),
                       "recovery": cp["values"].get("recovery"), "defect": cp["values"].get("defect"),
                       "safety_alert": cp["values"].get("safety_alert"), "coverage_gap": cp["values"].get("coverage_gap")},
        "shadow": [shadow.to_dict(r) for r in shadows],
        "work_order_status": wo_status,
    }
