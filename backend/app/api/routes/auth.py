from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.core.security import create_access_token, verify_password
from app.models import Tenant, User
from app.seed.generator import DEMO_PASSWORD

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


def user_out(u: User, t: Tenant) -> dict:
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role, "tenant_id": u.tenant_id,
            "tenant_name": t.name, "tenant_code": t.code}


@router.get("/config")
async def auth_config(s: SessionDep):
    """Tells the sign-in screen how to sign people in."""
    from app.core.gcip import tenant_map

    if settings.auth_mode == "gcip":
        tenants = []
        for g, t in tenant_map().items():
            row = await s.get(Tenant, t)
            tenants.append({"gcip_tenant_id": g, "tenant_id": t, "name": row.name if row else t})
        return {"mode": "gcip", "gcip": {"api_key": settings.gcip_api_key, "project_id": settings.gcip_project_id, "tenants": tenants}}
    return {"mode": "local"}


class GcipIn(BaseModel):
    id_token: str


@router.post("/gcip")
async def gcip_login(body: GcipIn, s: SessionDep):
    """Exchange a verified Google Cloud Identity Platform ID token for an app session."""
    from app.core.gcip import GcipError, user_for_claims, verify_id_token

    if settings.auth_mode != "gcip":
        raise HTTPException(400, "Identity Platform sign-in is not enabled (AUTH_MODE=gcip).")
    try:
        claims = await verify_id_token(body.id_token)
        u = await user_for_claims(s, claims)
    except GcipError as e:
        raise HTTPException(401, str(e))
    await s.commit()
    t = await s.get(Tenant, u.tenant_id)
    return {"access_token": create_access_token(u.id, u.tenant_id, u.role), "token_type": "bearer", "user": user_out(u, t)}


@router.post("/login")
async def login(body: LoginIn, s: SessionDep):
    if settings.auth_mode == "gcip":
        raise HTTPException(403, "Password sign-in is turned off. Sign in with your TransitTechOS (Identity Platform) account.")
    u = (await s.execute(select(User).where(User.email == body.email.strip().lower()))).scalar_one_or_none()
    if not u or not verify_password(body.password, u.password_hash) or not u.is_active:
        raise HTTPException(401, "Email or password is incorrect.")
    t = await s.get(Tenant, u.tenant_id)
    return {"access_token": create_access_token(u.id, u.tenant_id, u.role), "token_type": "bearer", "user": user_out(u, t)}


@router.get("/me")
async def me(user: CurrentUser, s: SessionDep):
    return user_out(user, await s.get(Tenant, user.tenant_id))


@router.get("/demo-accounts")
async def demo_accounts(s: SessionDep):
    """Only exposed in local mode so the sign-in screen can list the synthetic accounts."""
    if settings.environment != "local":
        return []
    rows = (await s.execute(select(User, Tenant).join(Tenant, Tenant.id == User.tenant_id).order_by(Tenant.name, User.role))).all()
    return [{"email": u.email, "full_name": u.full_name, "role": u.role, "tenant_name": t.name, "password": DEMO_PASSWORD} for u, t in rows]
