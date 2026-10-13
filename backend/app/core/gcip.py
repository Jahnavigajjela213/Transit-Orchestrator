"""Google Cloud Identity Platform (GCIP) sign-in.

TransitTechOS signs people in with GCIP. With AUTH_MODE=gcip the sign-in screen authenticates against Identity
Platform directly (REST, no SDK) and sends the resulting ID token here. We verify it the way Google documents:
RS256 signature against Google's published keys, audience = the GCIP project id, issuer =
https://securetoken.google.com/<project>, not expired, subject present. Multi-tenant Identity Platform tenants
are mapped to agencies with GCIP_TENANT_MAP. The verified identity is matched to a user row by email (or
provisioned from the "role" custom claim when GCIP_AUTO_PROVISION=true) and exchanged for an app session token.
API clients may also send a GCIP ID token directly as the Bearer token.
"""
import asyncio
import time
from typing import Optional

import jwt

from app.core.config import settings

GOOGLE_JWKS = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
ROLES = ("dispatcher", "shop_manager", "admin", "viewer")
_jwk_client: Optional[jwt.PyJWKClient] = None


class GcipError(Exception):
    pass


def tenant_map() -> dict[str, str]:
    """GCIP tenant id -> app tenant id."""
    out = {}
    for pair in filter(None, (p.strip() for p in settings.gcip_tenant_map.split(","))):
        gcip, _, app_tid = pair.partition(":")
        if gcip and app_tid:
            out[gcip.strip()] = app_tid.strip()
    return out


def _client() -> jwt.PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        _jwk_client = jwt.PyJWKClient(GOOGLE_JWKS, cache_keys=True, lifespan=3600)
    return _jwk_client


def _verify_sync(token: str) -> dict:
    if not settings.gcip_project_id:
        raise GcipError("GCIP_PROJECT_ID is not set.")
    try:
        key = _client().get_signing_key_from_jwt(token)
        claims = jwt.decode(token, key.key, algorithms=["RS256"], audience=settings.gcip_project_id,
                            issuer=f"https://securetoken.google.com/{settings.gcip_project_id}", leeway=30,
                            options={"require": ["exp", "iat", "sub", "aud", "iss"]})
    except jwt.PyJWTError as e:
        raise GcipError(f"Identity Platform token rejected: {e}") from e
    except Exception as e:  # network / key errors
        raise GcipError(f"Could not verify the Identity Platform token: {e}") from e
    if not claims.get("sub"):
        raise GcipError("Identity Platform token has no subject.")
    if claims.get("auth_time") and claims["auth_time"] > time.time() + 30:
        raise GcipError("Identity Platform token auth_time is in the future.")
    return claims


async def verify_id_token(token: str) -> dict:
    return await asyncio.to_thread(_verify_sync, token)


def app_tenant_for(claims: dict) -> Optional[str]:
    gcip_tenant = (claims.get("firebase") or {}).get("tenant")
    if gcip_tenant is None:
        return None
    mapping = tenant_map()
    if gcip_tenant not in mapping:
        raise GcipError(f"Identity Platform tenant {gcip_tenant} is not mapped to an agency (GCIP_TENANT_MAP).")
    return mapping[gcip_tenant]


async def user_for_claims(s, claims: dict):
    """Find (or provision) the app user for a verified GCIP identity."""
    from sqlalchemy import select

    from app.core.clock import new_id
    from app.core.security import hash_password
    from app.models import Tenant, User

    email = (claims.get("email") or "").strip().lower()
    if not email or not claims.get("email_verified", False):
        raise GcipError("Your Identity Platform account needs a verified email address.")
    tenant_id = app_tenant_for(claims)
    user = (await s.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user:
        if tenant_id and user.tenant_id != tenant_id:
            raise GcipError("This account belongs to a different agency than the Identity Platform tenant it signed in with.")
        if not user.is_active:
            raise GcipError("This account is not active.")
        return user
    if not settings.gcip_auto_provision or not tenant_id or not await s.get(Tenant, tenant_id):
        raise GcipError("No TransitTechOS user exists for this identity. Ask an administrator to add you.")
    role = claims.get("role") if claims.get("role") in ROLES else "viewer"
    user = User(id=new_id("usr"), tenant_id=tenant_id, email=email, full_name=claims.get("name") or email.split("@")[0], role=role,
                password_hash=hash_password(new_id("nopw")), is_active=True)
    s.add(user)
    await s.flush()
    return user
