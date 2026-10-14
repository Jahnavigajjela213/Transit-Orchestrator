from datetime import date
from typing import Optional

from fastapi import APIRouter

from app.api.deps import CurrentUser, SessionDep
from app.products.trip_mgmt import service

router = APIRouter(prefix="/products/trip-mgmt", tags=["product: trip management (Ecolane)"])


def row(o) -> dict:
    return {c.name: getattr(o, c.name) for c in o.__table__.columns}


@router.get("/vehicles")
async def vehicles(user: CurrentUser, s: SessionDep):
    return [row(v) for v in await service.list_vehicles(s, user.tenant_id)]


@router.get("/drivers")
async def drivers(user: CurrentUser, s: SessionDep):
    return [row(d) for d in await service.list_drivers(s, user.tenant_id)]


@router.get("/runs")
async def runs(user: CurrentUser, s: SessionDep, service_date: Optional[date] = None, vehicle_code: Optional[str] = None):
    return [row(r) for r in await service.list_runs(s, user.tenant_id, service_date, vehicle_code)]


@router.get("/runs/{run_id}/trips")
async def run_trips(run_id: str, user: CurrentUser, s: SessionDep):
    return [row(t) for t in await service.trips_for_runs(s, user.tenant_id, [run_id])]


@router.get("/availability-blocks")
async def blocks(user: CurrentUser, s: SessionDep):
    return [row(b) for b in await service.active_blocks(s, user.tenant_id)]


@router.get("/trip-requests")
async def trip_requests(user: CurrentUser, s: SessionDep, service_date: Optional[date] = None, status: Optional[str] = None):
    return [row(r) for r in await service.list_requests(s, user.tenant_id, service_date, status)]


# ---- manual actions a dispatcher takes directly in trip management (used in shadow mode and as the fallback)
from datetime import datetime  # noqa: E402

from fastapi import Depends, HTTPException  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from app.api.deps import require_roles  # noqa: E402
from app.core.clock import new_id, now  # noqa: E402
from app.core.errors import ProductAPIError  # noqa: E402
from app.models import User  # noqa: E402
from app.products.common import product_session  # noqa: E402


class BlockIn(BaseModel):
    start: Optional[datetime] = None
    end: datetime
    reason: str = "Pulled by dispatcher"


@router.post("/vehicles/{vehicle_code}/block")
async def manual_block(vehicle_code: str, body: BlockIn, user: User = Depends(require_roles("dispatcher"))):
    try:
        async with product_session() as s:
            blk = await service.block_vehicle(s, user.tenant_id, vehicle_code, body.start or now(), body.end, body.reason,
                                              f"manual:{new_id('blk')}", by=user.full_name)
            return row(blk)
    except ProductAPIError as e:
        raise HTTPException(400, e.message)


class ReleaseIn(BaseModel):
    reason: str = "Returned to service by dispatcher"


@router.post("/availability-blocks/{source_ref}/release")
async def manual_release(source_ref: str, body: ReleaseIn, user: User = Depends(require_roles("dispatcher", "shop_manager"))):
    try:
        async with product_session() as s:
            blk = await service.unblock_vehicle(s, user.tenant_id, source_ref, body.reason, by=user.full_name)
            if not blk:
                raise HTTPException(404, "No active block with that reference.")
            return row(blk)
    except ProductAPIError as e:
        raise HTTPException(400, e.message)


@router.post("/vehicles/{vehicle_code}/return")
async def manual_return(vehicle_code: str, body: ReleaseIn, user: User = Depends(require_roles("dispatcher", "shop_manager"))):
    """Put a vehicle back on the schedule by hand: releases every active block on it (or just marks it available)."""
    try:
        async with product_session() as s:
            blocks = [b for b in await service.active_blocks(s, user.tenant_id) if b.vehicle_code == vehicle_code]
            for b in blocks:
                await service.unblock_vehicle(s, user.tenant_id, b.source_ref, body.reason, by=user.full_name)
            if not blocks:
                await service.mark_available_by_hand(s, user.tenant_id, vehicle_code, by=user.full_name)
            return {"vehicle_code": vehicle_code, "released_blocks": len(blocks)}
    except ProductAPIError as e:
        raise HTTPException(400, e.message)


class AssignIn(BaseModel):
    vehicle_code: str
    driver_code: str


@router.post("/runs/{run_id}/assign")
async def manual_assign(run_id: str, body: AssignIn, user: User = Depends(require_roles("dispatcher"))):
    try:
        async with product_session() as s:
            r = await service.assign_run(s, user.tenant_id, run_id, body.vehicle_code, body.driver_code, f"manual:{new_id('asg')}", by=user.full_name)
            return row(r)
    except ProductAPIError as e:
        raise HTTPException(400, e.message)
