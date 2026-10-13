"""Analytics tables: the local stand-in for Databricks feature tables and the model registry."""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.clock import now
from app.core.database import Base


class OpsRunHistory(Base):
    """One row per run per day: what was scheduled, what happened, and the conditions."""

    __tablename__ = "an_run_history"
    id: Mapped[str] = mapped_column(String(48), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    service_date: Mapped[date] = mapped_column(Date, index=True)
    dow: Mapped[int] = mapped_column(Integer)  # 0 = Monday
    route_name: Mapped[str] = mapped_column(String(80), index=True)
    block: Mapped[str] = mapped_column(String(10))  # AM | PM
    hour_band: Mapped[str] = mapped_column(String(20))  # am_peak | midday | pm_peak
    depot: Mapped[str] = mapped_column(String(40))
    vehicle_label: Mapped[str] = mapped_column(String(20))
    vehicle_type: Mapped[str] = mapped_column(String(30))
    driver_id: Mapped[str] = mapped_column(String(40), index=True)
    driver_name: Mapped[str] = mapped_column(String(120))
    driver_tenure_years: Mapped[float] = mapped_column(Float)
    weather: Mapped[str] = mapped_column(String(20))  # clear | rain | fog | heat
    scheduled_trips: Mapped[int] = mapped_column(Integer)
    completed_trips: Mapped[int] = mapped_column(Integer)
    no_shows: Mapped[int] = mapped_column(Integer)
    late_cancels: Mapped[int] = mapped_column(Integer)
    wheelchair_boardings: Mapped[int] = mapped_column(Integer)
    load_factor: Mapped[float] = mapped_column(Float)
    recovery_min: Mapped[float] = mapped_column(Float)  # scheduled layover / recovery time in the block
    avg_dwell_min: Mapped[float] = mapped_column(Float)
    pm_overdue: Mapped[bool] = mapped_column(Boolean, default=False)
    road_call: Mapped[bool] = mapped_column(Boolean, default=False)  # breakdown during the run
    on_time_pickups: Mapped[int] = mapped_column(Integer)
    late_pickups: Mapped[int] = mapped_column(Integer)
    avg_late_min: Mapped[float] = mapped_column(Float)


class PerformanceModel(Base):
    """Model registry: one row per trained version per tenant."""

    __tablename__ = "an_models"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    version: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(40), default="late_pickup_logit")
    trained_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    trained_by: Mapped[str] = mapped_column(String(120), default="system")
    rows: Mapped[int] = mapped_column(Integer)
    date_from: Mapped[date] = mapped_column(Date)
    date_to: Mapped[date] = mapped_column(Date)
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    params: Mapped[dict] = mapped_column(JSON, default=dict)  # feature names, coefficients, scaler
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[Optional[str]] = mapped_column(String(400), nullable=True)
