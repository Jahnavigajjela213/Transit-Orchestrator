"""FastAPI dependencies: DB session, current user, role checks."""
from typing import Annotated

from fastapi import Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.security import decode_token
from app.models import User

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def _user_from_token(token: str, s: AsyncSession) -> User:
    try:
        payload = decode_token(token)
    except Exception:
        if settings.auth_mode == "gcip":  # API clients may send a GCIP ID token directly
            from app.core.gcip import GcipError, user_for_claims, verify_id_token

            try:
                return await user_for_claims(s, await verify_id_token(token))
            except GcipError as e:
                raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(e))
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has expired. Sign in again.")
    user = await s.get(User, payload.get("sub"))
    # End the read transaction now: the request session (and the SSE stream's, for the life of the tab) would
    # otherwise hold a lock on `users` and block the demo reset's DROP TABLE forever.
    await s.commit()
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "This account is not active.")
    return user


async def get_current_user(request: Request, s: SessionDep) -> User:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue.")
    return await _user_from_token(auth.removeprefix("Bearer "), s)


async def get_user_from_query_token(s: SessionDep, token: str = Query(...)) -> User:
    """EventSource cannot send headers, so the SSE stream takes the token as a query param."""
    return await _user_from_token(token, s)


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: str):
    async def checker(user: CurrentUser) -> User:
        if user.role not in roles and user.role != "admin":
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"This action needs one of these roles: {', '.join(roles)}.")
        return user

    return checker
