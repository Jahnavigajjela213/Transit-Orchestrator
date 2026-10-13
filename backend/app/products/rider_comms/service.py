"""Synthetic TripShot / Passio (rider communications)."""
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import new_id, now
from app.core.errors import ProductAPIError
from app.models import Notification, Rider
from app.core.events import CloudEvent, EventTypes
from app.products.common import check_fault, queue_event

SYSTEM = "rider_comms"


async def get_rider(s: AsyncSession, tenant_id: str, rider_id: str) -> Rider:
    r = await s.get(Rider, rider_id)
    if not r or r.tenant_id != tenant_id:
        raise ProductAPIError(SYSTEM, "get_rider", f"Rider {rider_id} not found")
    return r


async def send(
    s: AsyncSession, tenant_id: str, *, rider_id: str, trip_id: Optional[str], kind: str, message: str,
    workflow_id: Optional[str], idempotency_key: str, by: Optional[str] = None,
) -> Notification:
    await check_fault(tenant_id, SYSTEM, "send")
    existing = (await s.execute(select(Notification).where(Notification.idempotency_key == idempotency_key))).scalar_one_or_none()
    if existing:
        return existing
    rider = await get_rider(s, tenant_id, rider_id)
    n = Notification(
        id=new_id("ntf"), tenant_id=tenant_id, rider_id=rider_id, trip_id=trip_id, channel=rider.preferred_channel,
        kind=kind, message=message, status="sent", workflow_id=workflow_id, idempotency_key=idempotency_key, created_at=now(),
    )
    s.add(n)
    await s.flush()
    if workflow_id is None:  # sent by a person from the rider comms console
        queue_event(s, CloudEvent(type=EventTypes.RIDER_NOTIFIED, source=SYSTEM, tenantid=tenant_id,
                                  data={"notification_id": n.id, "rider_id": rider_id, "trip_id": trip_id, "kind": kind, "channel": n.channel,
                                        "manual": True, "by": by}))
    return n


async def list_notifications(s: AsyncSession, tenant_id: str, workflow_id: Optional[str] = None, limit: int = 300) -> list[Notification]:
    q = select(Notification).where(Notification.tenant_id == tenant_id)
    if workflow_id:
        q = q.where(Notification.workflow_id == workflow_id)
    return list((await s.execute(q.order_by(Notification.created_at.desc()).limit(limit))).scalars())
