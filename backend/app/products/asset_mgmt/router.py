"""REST surface of the synthetic FASTER system (what the real product API would expose)."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import CurrentUser, SessionDep, require_roles
from app.core.errors import ProductAPIError
from app.models import User
from app.products.asset_mgmt import service
from app.products.common import product_session

router = APIRouter(prefix="/products/asset-mgmt", tags=["product: asset management (FASTER)"])


def wo_dict(wo) -> dict:
    return {c.name: getattr(wo, c.name) for c in wo.__table__.columns}


@router.get("/assets")
async def assets(user: CurrentUser, s: SessionDep):
    rows = await service.list_assets(s, user.tenant_id)
    return [{**{c.name: getattr(a, c.name) for c in a.__table__.columns}, "pm_miles_over": service.pm_miles_over(a)} for a in rows]


@router.get("/fault-codes")
async def fault_codes(user: CurrentUser, s: SessionDep):
    return [{c.name: getattr(f, c.name) for c in f.__table__.columns} for f in await service.list_fault_codes(s)]


@router.get("/work-orders")
async def work_orders(user: CurrentUser, s: SessionDep, status: Optional[str] = None):
    return [wo_dict(w) for w in await service.list_work_orders(s, user.tenant_id, status)]


class CreateWO(BaseModel):
    asset_number: str
    priority: str = "medium"
    title: str
    description: str = ""
    fault_code: Optional[str] = None
    shop_start: Optional[datetime] = None
    shop_end: Optional[datetime] = None


@router.post("/work-orders")
async def create_wo(body: CreateWO, user: User = Depends(require_roles("shop_manager", "dispatcher"))):
    try:
        async with product_session() as s:
            wo = await service.create_work_order(s, user.tenant_id, created_by=user.full_name, source="manual", **body.model_dump())
            return wo_dict(wo)
    except ProductAPIError as e:
        raise HTTPException(400, e.message)


class CloseWO(BaseModel):
    resolution: str = "Repaired and road tested"


@router.post("/work-orders/{wo_id}/start")
async def start_wo(wo_id: str, user: User = Depends(require_roles("shop_manager"))):
    try:
        async with product_session() as s:
            return wo_dict(await service.start_work_order(s, user.tenant_id, wo_id, user.full_name))
    except ProductAPIError as e:
        raise HTTPException(400, e.message)


@router.post("/work-orders/{wo_id}/close")
async def close_wo(wo_id: str, body: CloseWO, user: User = Depends(require_roles("shop_manager"))):
    try:
        async with product_session() as s:
            return wo_dict(await service.close_work_order(s, user.tenant_id, wo_id, user.full_name, body.resolution))
    except ProductAPIError as e:
        raise HTTPException(400, e.message)
