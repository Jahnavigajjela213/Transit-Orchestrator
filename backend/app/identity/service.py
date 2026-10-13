"""Resolves product-specific IDs to canonical IDs and back.

Replace the body of these methods with calls to the real shared identity layer
(GCIP-secured) once it is available. Callers do not change.
"""
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CanonicalEntity, Crosswalk

SYSTEMS = ("asset_mgmt", "trip_mgmt", "workforce", "telematics", "safety")


class IdentityService:
    async def to_canonical(self, s: AsyncSession, tenant_id: str, system: str, external_id: str) -> Optional[str]:
        return (
            await s.execute(
                select(Crosswalk.canonical_id).where(
                    Crosswalk.tenant_id == tenant_id, Crosswalk.system == system, Crosswalk.external_id == external_id
                )
            )
        ).scalar_one_or_none()

    async def to_external(self, s: AsyncSession, tenant_id: str, canonical_id: str, system: str) -> Optional[str]:
        return (
            await s.execute(
                select(Crosswalk.external_id).where(
                    Crosswalk.tenant_id == tenant_id, Crosswalk.canonical_id == canonical_id, Crosswalk.system == system
                )
            )
        ).scalar_one_or_none()

    async def map_external(self, s: AsyncSession, tenant_id: str, from_system: str, to_system: str, external_id: str) -> Optional[str]:
        cid = await self.to_canonical(s, tenant_id, from_system, external_id)
        return await self.to_external(s, tenant_id, cid, to_system) if cid else None

    async def label(self, s: AsyncSession, canonical_id: str) -> Optional[str]:
        ent = await s.get(CanonicalEntity, canonical_id)
        return ent.label if ent else None

    async def by_label(self, s: AsyncSession, tenant_id: str, entity_type: str, label: str) -> Optional[str]:
        return (
            await s.execute(
                select(CanonicalEntity.id).where(
                    CanonicalEntity.tenant_id == tenant_id,
                    CanonicalEntity.entity_type == entity_type,
                    CanonicalEntity.label == label,
                )
            )
        ).scalar_one_or_none()

    async def all_ids(self, s: AsyncSession, tenant_id: str, canonical_id: str) -> dict[str, str]:
        rows = (
            await s.execute(
                select(Crosswalk.system, Crosswalk.external_id).where(
                    Crosswalk.tenant_id == tenant_id, Crosswalk.canonical_id == canonical_id
                )
            )
        ).all()
        return {sys: ext for sys, ext in rows}

    async def map_for_system(self, s: AsyncSession, tenant_id: str, system: str, entity_type: str) -> dict[str, str]:
        """external_id -> canonical_id for every entity of a type in one system."""
        rows = (
            await s.execute(
                select(Crosswalk.external_id, Crosswalk.canonical_id).where(
                    Crosswalk.tenant_id == tenant_id, Crosswalk.system == system, Crosswalk.entity_type == entity_type
                )
            )
        ).all()
        return {e: c for e, c in rows}


identity = IdentityService()
