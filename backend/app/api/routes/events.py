from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep
from app.api.serializers import row
from app.core.config import settings
from app.core.event_bus import bus
from app.core.events import CloudEvent, EventTypes
from app.models import EventRecord, Tenant

router = APIRouter(prefix="/api/events", tags=["event backbone"])


@router.get("")
async def list_events(user: CurrentUser, s: SessionDep, type: Optional[str] = None, status: Optional[str] = None, limit: int = 200):
    q = select(EventRecord).where(EventRecord.tenant_id == user.tenant_id)
    if type:
        q = q.where(EventRecord.type == type)
    if status:
        q = q.where(EventRecord.status.in_(status.split(",")))
    return [row(e) for e in (await s.execute(q.order_by(EventRecord.received_at.desc()).limit(limit))).scalars()]


@router.get("/export")
async def export(user: CurrentUser, s: SessionDep, since_hours: int = 24, type: Optional[str] = None):
    """Events as JSON Lines of CloudEvents, for archiving or replaying through Simulator -> Replay events."""
    import json
    from datetime import timedelta

    from fastapi.responses import Response

    from app.core.clock import now

    q = select(EventRecord).where(EventRecord.tenant_id == user.tenant_id, EventRecord.received_at >= now() - timedelta(hours=since_hours),
                                  EventRecord.source != "orchestrator")
    if type:
        q = q.where(EventRecord.type.in_(type.split(",")))
    lines = []
    for e in (await s.execute(q.order_by(EventRecord.time))).scalars():
        ce = CloudEvent(id=e.id, type=e.type, source=e.source, subject=e.subject, time=e.time, tenantid=e.tenant_id, data=e.data or {},
                        dedupekey=e.dedupe_key, correlationid=e.correlation_id, traceid=e.trace_id)
        lines.append(json.dumps(ce.model_dump(mode="json")))
    return Response("\n".join(lines) + ("\n" if lines else ""), media_type="application/x-ndjson",
                    headers={"Content-Disposition": f'attachment; filename="events-{user.tenant_id}.jsonl"'})


@router.get("/catalog")
async def catalog(user: CurrentUser):
    return [{"type": k, **v} for k, v in EventTypes.CATALOG.items()]


@router.post("/ingest", status_code=202)
async def ingest(event: CloudEvent, s: SessionDep, x_ingest_key: str = Header(...)):
    """Webhook for real products (or an EventBridge -> API destination) to publish CloudEvents."""
    if x_ingest_key != settings.ingest_api_key:
        raise HTTPException(401, "Invalid ingest key.")
    if not await s.get(Tenant, event.tenantid):
        raise HTTPException(400, "Unknown tenant.")
    res = await bus.publish(event)
    return {"id": res.event_id, "status": res.status}
