"""Shared identity layer: canonical IDs + crosswalk to each product's own IDs.

This is the interim crosswalk described in the proposal. When the real shared
identity layer (immutable trip/driver/vehicle IDs) ships, IdentityService is the
only component that changes.
"""
from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CanonicalEntity(Base):
    __tablename__ = "canonical_entities"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)  # e.g. veh_..., drv_..., trp_...
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    entity_type: Mapped[str] = mapped_column(String(20), index=True)  # vehicle | driver | trip
    label: Mapped[str] = mapped_column(String(80))


class Crosswalk(Base):
    __tablename__ = "identity_crosswalk"
    __table_args__ = (UniqueConstraint("tenant_id", "system", "external_id"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    entity_type: Mapped[str] = mapped_column(String(20))
    canonical_id: Mapped[str] = mapped_column(ForeignKey("canonical_entities.id"), index=True)
    system: Mapped[str] = mapped_column(String(30))  # asset_mgmt | trip_mgmt | workforce | telematics
    external_id: Mapped[str] = mapped_column(String(60))
