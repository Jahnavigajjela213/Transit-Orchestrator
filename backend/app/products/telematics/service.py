"""Synthetic telematics: devices stream readings; a DTC in a reading publishes a fault event."""
import random
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import new_id, now
from app.core.events import CloudEvent, EventTypes
from app.identity.service import identity
from app.models import FaultCode, TelemetryDevice, TelemetryReading
from app.products.common import queue_event

SYSTEM = "telematics"


async def list_devices(s: AsyncSession, tenant_id: str) -> list[TelemetryDevice]:
    return list((await s.execute(select(TelemetryDevice).where(TelemetryDevice.tenant_id == tenant_id))).scalars())


async def latest_readings(s: AsyncSession, tenant_id: str) -> dict[str, TelemetryReading]:
    sub = (
        select(TelemetryReading.device_id, func.max(TelemetryReading.ts).label("mx"))
        .where(TelemetryReading.tenant_id == tenant_id)
        .group_by(TelemetryReading.device_id)
        .subquery()
    )
    q = select(TelemetryReading).join(sub, (TelemetryReading.device_id == sub.c.device_id) & (TelemetryReading.ts == sub.c.mx))
    return {r.device_id: r for r in (await s.execute(q)).scalars()}


def synthetic_reading(device_id: str, odometer: int, dtc: Optional[str] = None) -> dict:
    hot = dtc == "P0217"
    low_oil = dtc == "P0520"
    return {
        "device_id": device_id,
        "engine_temp_c": round(random.uniform(112, 121) if hot else random.uniform(82, 96), 1),
        "oil_pressure_kpa": round(random.uniform(60, 110) if low_oil else random.uniform(240, 380), 1),
        "battery_v": round(random.uniform(12.4, 14.2), 2),
        "speed_kph": round(random.uniform(0, 62), 1),
        "odometer": odometer + random.randint(0, 3),
        "dtc_codes": [dtc] if dtc else [],
    }


async def ingest_reading(s: AsyncSession, tenant_id: str, reading: dict, *, duplicate_of: Optional[str] = None) -> TelemetryReading:
    """Store a reading. If it carries a DTC, publish vehicle.fault.detected.

    The dedupe key (device + code + hour) means a device that keeps repeating the
    same fault does not start a second workflow.
    """
    rec = TelemetryReading(
        id=new_id("tlr"), tenant_id=tenant_id, device_id=reading["device_id"], ts=now(),
        engine_temp_c=reading["engine_temp_c"], oil_pressure_kpa=reading["oil_pressure_kpa"],
        battery_v=reading["battery_v"], speed_kph=reading["speed_kph"], odometer=reading["odometer"],
        dtc_codes=reading.get("dtc_codes", []),
    )
    s.add(rec)
    await s.flush()
    vehicle_id = await identity.to_canonical(s, tenant_id, SYSTEM, reading["device_id"])
    for code in rec.dtc_codes:
        fc = await s.get(FaultCode, code)
        hour_bucket = rec.ts.strftime("%Y%m%d%H")
        queue_event(s, CloudEvent(
            type=EventTypes.VEHICLE_FAULT_DETECTED, source=SYSTEM, subject=vehicle_id, tenantid=tenant_id,
            data={
                "device_id": rec.device_id, "fault_code": code, "description": fc.description if fc else code,
                "reading": {k: v for k, v in reading.items() if k != "dtc_codes"}, "reading_id": rec.id,
            },
            dedupekey=f"dtc:{rec.device_id}:{code}:{hour_bucket}",
        ))
    return rec
