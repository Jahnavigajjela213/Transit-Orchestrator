"""REST surface of the synthetic Vestige system (what the real product API would expose)."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import CurrentUser, SessionDep, require_roles
from app.core.clock import now
from app.core.errors import ProductAPIError
from app.models import User
from app.products.common import product_session
from app.products.safety import service

router = APIRouter(prefix="/products/safety", tags=["product: safety & compliance (Vestige)"])


def row(o) -> dict:
    return {c.name: getattr(o, c.name) for c in o.__table__.columns}


@router.get("/drivers")
async def drivers(user: CurrentUser, s: SessionDep):
    today = now().date()
    return [service.compliance(d, today) for d in await service.list_drivers(s, user.tenant_id)]


@router.get("/defects")
async def defects(user: CurrentUser, s: SessionDep, status: Optional[str] = None):
    from app.identity.service import identity

    out = []
    for d in await service.list_defects(s, user.tenant_id, status):
        cid = await identity.to_canonical(s, user.tenant_id, service.SYSTEM, d.vehicle_ref)
        out.append({**row(d), "vehicle_label": await identity.label(s, cid) if cid else d.vehicle_ref})
    return out


class DefectIn(BaseModel):
    vehicle_ref: Optional[str] = None  # Vestige's own id, or
    vehicle_label: Optional[str] = None  # the fleet number people use (P-219)
    category: str
    severity: str = "high"
    description: str = ""


@router.post("/defects")
async def create_defect(body: DefectIn, user: User = Depends(require_roles("shop_manager", "dispatcher"))):
    try:
        async with product_session() as s:
            ref = body.vehicle_ref
            if not ref and body.vehicle_label:
                from app.identity.service import identity

                vid = await identity.by_label(s, user.tenant_id, "vehicle", body.vehicle_label.strip().upper())
                ref = await identity.to_external(s, user.tenant_id, vid, "safety") if vid else None
            if not ref:
                raise HTTPException(400, f"Vehicle {body.vehicle_label or ''} not found in Vestige.")
            return row(await service.open_defect(s, user.tenant_id, vehicle_ref=ref, category=body.category, severity=body.severity,
                                                 description=body.description, created_by=user.full_name, source="manual"))
    except ProductAPIError as e:
        raise HTTPException(400, e.message)


class CloseIn(BaseModel):
    resolution: str = "Repaired and inspected"


@router.post("/defects/{defect_id}/close")
async def close_defect(defect_id: str, body: CloseIn, user: User = Depends(require_roles("shop_manager"))):
    try:
        async with product_session() as s:
            return row(await service.close_defect(s, user.tenant_id, defect_id, user.full_name, body.resolution))
    except ProductAPIError as e:
        raise HTTPException(400, e.message)
