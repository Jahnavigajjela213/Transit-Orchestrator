"""Synthetic stand-ins for the real product systems.

Each block below represents one product's own data store. They live in the same
database for convenience but are only touched through their product service
modules (app/products/*) - never by agents directly.
"""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.clock import now
from app.core.database import Base


# ---------------- Asset Management (FASTER) ----------------
class Asset(Base):
    __tablename__ = "am_assets"
    asset_number: Mapped[str] = mapped_column(String(30), primary_key=True)  # FA-10023
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    unit_label: Mapped[str] = mapped_column(String(20))
    make: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(40))
    year: Mapped[int] = mapped_column(Integer)
    vin: Mapped[str] = mapped_column(String(20))
    odometer: Mapped[int] = mapped_column(Integer)
    last_pm_date: Mapped[date] = mapped_column(Date)
    last_pm_odometer: Mapped[int] = mapped_column(Integer)
    pm_interval_miles: Mapped[int] = mapped_column(Integer, default=6000)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | in_shop | retired
    depot: Mapped[str] = mapped_column(String(40))


class WorkOrder(Base):
    __tablename__ = "am_work_orders"
    id: Mapped[str] = mapped_column(String(30), primary_key=True)  # WO-2026-00041
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    asset_number: Mapped[str] = mapped_column(String(30), index=True)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | in_progress | closed | cancelled
    priority: Mapped[str] = mapped_column(String(20))  # critical | high | medium | low
    fault_code: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(30), default="manual")  # manual | orchestrator
    shop_depot: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    shop_start: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    shop_end: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    external_ref: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    created_by: Mapped[str] = mapped_column(String(120), default="system")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    closed_by: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    resolution: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class ShopCapacity(Base):
    __tablename__ = "am_shop_capacity"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    depot: Mapped[str] = mapped_column(String(40))
    day: Mapped[date] = mapped_column(Date)
    bays_total: Mapped[int] = mapped_column(Integer)
    bays_booked: Mapped[int] = mapped_column(Integer, default=0)


class FaultCode(Base):
    __tablename__ = "am_fault_codes"
    code: Mapped[str] = mapped_column(String(20), primary_key=True)
    description: Mapped[str] = mapped_column(String(200))
    system: Mapped[str] = mapped_column(String(40))
    severity: Mapped[str] = mapped_column(String(20))  # critical | high | medium | low
    est_repair_hours: Mapped[int] = mapped_column(Integer)
    affects_accessibility: Mapped[bool] = mapped_column(Boolean, default=False)


# ---------------- Trip Management (Ecolane / TripMaster) ----------------
class FleetVehicle(Base):
    __tablename__ = "tm_vehicles"
    vehicle_code: Mapped[str] = mapped_column(String(30), primary_key=True)  # ECO-V105
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    label: Mapped[str] = mapped_column(String(20))
    vehicle_type: Mapped[str] = mapped_column(String(30))
    capacity: Mapped[int] = mapped_column(Integer)
    wheelchair_positions: Mapped[int] = mapped_column(Integer, default=0)
    depot: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="available")  # available | out_of_service


class AvailabilityBlock(Base):
    __tablename__ = "tm_availability_blocks"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    vehicle_code: Mapped[str] = mapped_column(String(30), index=True)
    start: Mapped[datetime] = mapped_column(DateTime)
    end: Mapped[datetime] = mapped_column(DateTime)
    reason: Mapped[str] = mapped_column(String(200))
    source_ref: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class TripDriver(Base):
    __tablename__ = "tm_drivers"
    driver_code: Mapped[str] = mapped_column(String(30), primary_key=True)  # ECO-D033
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    name: Mapped[str] = mapped_column(String(120))


class Run(Base):
    __tablename__ = "tm_runs"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)  # RUN-MVT-0412-AM
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    service_date: Mapped[date] = mapped_column(Date, index=True)
    route_name: Mapped[str] = mapped_column(String(80))
    block_name: Mapped[str] = mapped_column(String(20))
    start_time: Mapped[datetime] = mapped_column(DateTime)
    end_time: Mapped[datetime] = mapped_column(DateTime)
    vehicle_code: Mapped[Optional[str]] = mapped_column(String(30), index=True, nullable=True)
    driver_code: Mapped[Optional[str]] = mapped_column(String(30), index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="scheduled")
    original_vehicle_code: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    original_driver_code: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    reassigned: Mapped[bool] = mapped_column(Boolean, default=False)
    reassignment_ref: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    delay_minutes: Mapped[int] = mapped_column(Integer, default=0)  # how late the run is running now


class Trip(Base):
    __tablename__ = "tm_trips"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    run_id: Mapped[str] = mapped_column(String(40), index=True)
    rider_id: Mapped[str] = mapped_column(String(40), index=True)
    pickup_time: Mapped[datetime] = mapped_column(DateTime)
    eta: Mapped[datetime] = mapped_column(DateTime)
    pickup_stop: Mapped[str] = mapped_column(String(120))
    dropoff_stop: Mapped[str] = mapped_column(String(120))
    needs_wheelchair: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="booked")  # booked | completed | no_show | cancelled
    source_ref: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)  # workflow that booked it (standby insert)


class TripRequest(Base):
    """Standby list: riders who asked for a ride that could not be scheduled yet."""

    __tablename__ = "tm_trip_requests"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    rider_id: Mapped[str] = mapped_column(String(40), index=True)
    service_date: Mapped[date] = mapped_column(Date, index=True)
    route_name: Mapped[str] = mapped_column(String(80))  # zone or route the request can be served from
    window_start: Mapped[datetime] = mapped_column(DateTime)
    window_end: Mapped[datetime] = mapped_column(DateTime)
    pickup_stop: Mapped[str] = mapped_column(String(120))
    dropoff_stop: Mapped[str] = mapped_column(String(120))
    purpose: Mapped[str] = mapped_column(String(20), default="standard")  # medical | work | standard
    needs_wheelchair: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="waiting")  # waiting | booked | expired | cancelled
    booked_trip_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class NoShowLog(Base):
    __tablename__ = "tm_no_show_log"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    rider_id: Mapped[str] = mapped_column(String(40), index=True)
    trip_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    service_date: Mapped[date] = mapped_column(Date, index=True)
    kind: Mapped[str] = mapped_column(String(20))  # no_show | late_cancel


# ---------------- Workforce (Bytecurve) ----------------
class Employee(Base):
    __tablename__ = "wf_employees"
    employee_number: Mapped[str] = mapped_column(String(30), primary_key=True)  # BC-E1203
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    license_class: Mapped[str] = mapped_column(String(5))  # B | C
    certifications: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | leave
    home_depot: Mapped[str] = mapped_column(String(40))
    max_daily_hours: Mapped[float] = mapped_column(Float, default=10.0)
    phone: Mapped[str] = mapped_column(String(30))
    hire_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)


# ---------------- Rider Communications (TripShot / Passio) ----------------
class Rider(Base):
    __tablename__ = "rc_riders"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(30))
    email: Mapped[str] = mapped_column(String(160))
    preferred_channel: Mapped[str] = mapped_column(String(10))  # sms | email | app
    language: Mapped[str] = mapped_column(String(5), default="en")  # en | es | zh


class Notification(Base):
    __tablename__ = "rc_notifications"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    rider_id: Mapped[str] = mapped_column(String(40), index=True)
    trip_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    channel: Mapped[str] = mapped_column(String(10))
    kind: Mapped[str] = mapped_column(String(30))  # eta_update | vehicle_change | correction
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="sent")
    workflow_id: Mapped[Optional[str]] = mapped_column(String(40), index=True, nullable=True)
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(200), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


# ---------------- Telematics ----------------
class TelemetryDevice(Base):
    __tablename__ = "tl_devices"
    device_id: Mapped[str] = mapped_column(String(30), primary_key=True)  # TLM-88A1
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    firmware: Mapped[str] = mapped_column(String(20), default="4.2.1")
    online: Mapped[bool] = mapped_column(Boolean, default=True)


class TelemetryReading(Base):
    __tablename__ = "tl_readings"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    device_id: Mapped[str] = mapped_column(String(30), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime, index=True)
    engine_temp_c: Mapped[float] = mapped_column(Float)
    oil_pressure_kpa: Mapped[float] = mapped_column(Float)
    battery_v: Mapped[float] = mapped_column(Float)
    speed_kph: Mapped[float] = mapped_column(Float)
    odometer: Mapped[int] = mapped_column(Integer)
    dtc_codes: Mapped[list] = mapped_column(JSON, default=list)


# ---------------- Safety & Compliance (Vestige) ----------------
class SafetyDriver(Base):
    """Driver compliance record in Vestige: medical card, drug and alcohol testing, required training."""

    __tablename__ = "sf_drivers"
    safety_id: Mapped[str] = mapped_column(String(30), primary_key=True)  # VS-D2003
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    name: Mapped[str] = mapped_column(String(120))
    medical_card_expires: Mapped[date] = mapped_column(Date)
    drug_test_due: Mapped[date] = mapped_column(Date)
    securement_training_due: Mapped[date] = mapped_column(Date)  # wheelchair securement refresher
    status: Mapped[str] = mapped_column(String(20), default="compliant")  # compliant | suspended
    preventable_incidents_12m: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")


class SafetyDefect(Base):
    """Vehicle defect record in Vestige (the safety side of a mechanical fault)."""

    __tablename__ = "sf_defects"
    id: Mapped[str] = mapped_column(String(30), primary_key=True)  # DEF-2026-00012
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    vehicle_ref: Mapped[str] = mapped_column(String(30), index=True)  # VS-V105
    category: Mapped[str] = mapped_column(String(40))
    severity: Mapped[str] = mapped_column(String(20))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | closed
    out_of_service: Mapped[bool] = mapped_column(Boolean, default=True)
    source: Mapped[str] = mapped_column(String(30), default="manual")  # orchestrator | inspection | manual
    external_ref: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    work_order_id: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    created_by: Mapped[str] = mapped_column(String(120), default="system")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    closed_by: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    resolution: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
