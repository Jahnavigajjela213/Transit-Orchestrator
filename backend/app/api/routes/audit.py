import csv
import io
import json
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep
from app.api.serializers import row
from app.models import AuditRecord

router = APIRouter(prefix="/api/audit", tags=["audit log"])


def _query(tid: str, workflow_id: Optional[str], record_type: Optional[str], actor_type: Optional[str], q: Optional[str]):
    stmt = select(AuditRecord).where(AuditRecord.tenant_id == tid)
    if workflow_id:
        stmt = stmt.where(AuditRecord.workflow_id == workflow_id)
    if record_type:
        stmt = stmt.where(AuditRecord.record_type.in_(record_type.split(",")))
    if actor_type:
        stmt = stmt.where(AuditRecord.actor_type == actor_type)
    if q:
        stmt = stmt.where(AuditRecord.explanation.ilike(f"%{q}%"))
    return stmt


@router.get("")
async def list_audit(user: CurrentUser, s: SessionDep, workflow_id: Optional[str] = None, record_type: Optional[str] = None,
                     actor_type: Optional[str] = None, q: Optional[str] = None, limit: int = 200):
    stmt = _query(user.tenant_id, workflow_id, record_type, actor_type, q).order_by(AuditRecord.created_at.desc(), AuditRecord.id.desc()).limit(limit)
    return [row(r) for r in (await s.execute(stmt)).scalars()]


@router.get("/export")
async def export(user: CurrentUser, s: SessionDep, format: str = "jsonl", workflow_id: Optional[str] = None):
    rows = [row(r) for r in (await s.execute(_query(user.tenant_id, workflow_id, None, None, None).order_by(AuditRecord.created_at))).scalars()]
    if format == "csv":
        buf = io.StringIO()
        if rows:
            w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
            w.writeheader()
            for r in rows:
                w.writerow({k: json.dumps(v, default=str) if isinstance(v, (dict, list)) else v for k, v in r.items()})
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": "attachment; filename=audit_log.csv"})
    body = "\n".join(json.dumps(r, default=str) for r in rows)
    return StreamingResponse(iter([body]), media_type="application/x-ndjson",
                             headers={"Content-Disposition": "attachment; filename=audit_log.jsonl"})


from fastapi import Depends  # noqa: E402

from app.api.deps import require_roles  # noqa: E402
from app.models import User  # noqa: E402


@router.get("/mirror/status")
async def mirror_status(user: CurrentUser):
    """Delivery of audit records to the analytics mirror (JSONL / Databricks Delta)."""
    from app.audit.shipper import shipper

    return await shipper.status(user.tenant_id)


@router.post("/mirror/retry")
async def mirror_retry(user: User = Depends(require_roles("admin"))):
    from app.audit.shipper import shipper

    n = await shipper.retry_failed(user.tenant_id)
    shipped = await shipper.flush()
    return {"requeued": n, "shipped_now": shipped}
