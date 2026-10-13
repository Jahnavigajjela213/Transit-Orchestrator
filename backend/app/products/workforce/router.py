from fastapi import APIRouter

from app.api.deps import CurrentUser, SessionDep
from app.products.workforce import service

router = APIRouter(prefix="/products/workforce", tags=["product: workforce (Bytecurve)"])


@router.get("/employees")
async def employees(user: CurrentUser, s: SessionDep):
    return [{c.name: getattr(e, c.name) for c in e.__table__.columns} for e in await service.list_employees(s, user.tenant_id)]
