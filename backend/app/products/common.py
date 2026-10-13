"""Helpers shared by the synthetic product systems."""
from contextlib import asynccontextmanager
from typing import AsyncIterator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import SessionLocal, session_scope
from app.core.errors import ProductAPIError
from app.core.event_bus import bus
from app.core.events import CloudEvent
from app.models import FaultInjection


def queue_event(s: AsyncSession, event: CloudEvent) -> None:
    """Stage an event; it is published only after the product transaction commits."""
    s.info.setdefault("outbox", []).append(event)


async def publish_outbox(s: AsyncSession) -> None:
    events = s.info.pop("outbox", [])
    for e in events:
        await bus.publish(e)


@asynccontextmanager
async def product_session() -> AsyncIterator[AsyncSession]:
    """Transaction for a product call: commit, then publish the events it produced."""
    async with SessionLocal() as s:
        try:
            yield s
            await s.commit()
        except Exception:
            await s.rollback()
            s.info.pop("outbox", None)
            raise
        await publish_outbox(s)


async def check_fault(tenant_id: str, system: str, action: str) -> None:
    """Fail on purpose if the simulator injected a fault for this action.

    Uses its own transaction so the counter is saved even though the action fails.
    """
    target = f"{system}.{action}"
    async with session_scope() as s:
        fi = (
            await s.execute(
                select(FaultInjection)
                .where(FaultInjection.tenant_id == tenant_id, FaultInjection.target == target, FaultInjection.active.is_(True))
                .limit(1)
            )
        ).scalar_one_or_none()
        if not fi:
            return
        transient = fi.mode == "fail_once"
        fi.remaining -= 1
        if fi.remaining <= 0 and fi.mode == "fail_once":
            fi.active = False
        message = fi.message
    raise ProductAPIError(system, action, message, transient=transient)
