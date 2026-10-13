from typing import Optional

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep
from app.models import Rider
from app.products.rider_comms import service

router = APIRouter(prefix="/products/rider-comms", tags=["product: rider comms (TripShot)"])


@router.get("/notifications")
async def notifications(user: CurrentUser, s: SessionDep, workflow_id: Optional[str] = None):
    rows = await service.list_notifications(s, user.tenant_id, workflow_id)
    riders = {r.id: r for r in (await s.execute(select(Rider).where(Rider.tenant_id == user.tenant_id))).scalars()}
    out = []
    for n in rows:
        r = riders.get(n.rider_id)
        out.append({**{c.name: getattr(n, c.name) for c in n.__table__.columns},
                    "rider_name": r.name if r else n.rider_id, "language": r.language if r else "en",
                    "contact": (r.email if n.channel == "email" else r.phone) if r else ""})
    return out


@router.get("/riders")
async def riders(user: CurrentUser, s: SessionDep):
    rows = (await s.execute(select(Rider).where(Rider.tenant_id == user.tenant_id).order_by(Rider.name))).scalars()
    return [{c.name: getattr(r, c.name) for c in r.__table__.columns} for r in rows]


from fastapi import Depends, HTTPException  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from app.api.deps import require_roles  # noqa: E402
from app.core.clock import new_id  # noqa: E402
from app.core.errors import ProductAPIError  # noqa: E402
from app.models import User  # noqa: E402
from app.products.common import product_session  # noqa: E402


class SendIn(BaseModel):
    rider_id: str
    trip_id: Optional[str] = None
    message: str
    kind: str = "manual"


@router.post("/notifications")
async def manual_send(body: SendIn, user: User = Depends(require_roles("dispatcher"))):
    """A dispatcher messaging a rider by hand from the rider comms console."""
    try:
        async with product_session() as s:
            n = await service.send(s, user.tenant_id, rider_id=body.rider_id, trip_id=body.trip_id, kind=body.kind, message=body.message,
                                   workflow_id=None, idempotency_key=new_id("manual"), by=user.full_name)
            return {c.name: getattr(n, c.name) for c in n.__table__.columns}
    except ProductAPIError as e:
        raise HTTPException(400, e.message)
