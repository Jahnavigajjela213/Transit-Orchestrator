from fastapi import APIRouter

from app.api.deps import CurrentUser, SessionDep
from app.products.telematics import service

router = APIRouter(prefix="/products/telematics", tags=["product: telematics"])


@router.get("/devices")
async def devices(user: CurrentUser, s: SessionDep):
    latest = await service.latest_readings(s, user.tenant_id)
    out = []
    for d in await service.list_devices(s, user.tenant_id):
        r = latest.get(d.device_id)
        out.append({
            "device_id": d.device_id, "firmware": d.firmware, "online": d.online,
            "latest": {c.name: getattr(r, c.name) for c in r.__table__.columns} if r else None,
        })
    return out
