"""Synthetic Vestige (safety and compliance): driver compliance records and vehicle defects."""
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import now
from app.core.errors import ProductAPIError
from app.core.events import CloudEvent, EventTypes
from app.identity.service import identity
from app.models import SafetyDefect, SafetyDriver
from app.products.common import check_fault, queue_event

SYSTEM = "safety"


def compliance(d: SafetyDriver, on: date) -> dict:
    """Blocking reasons stop a driver from any run; securement training only matters on wheelchair runs."""
    blocking, wheelchair = [], []
    if d.status == "suspended":
        blocking.append("suspended in Vestige" + (f" ({d.notes})" if d.notes else ""))
    if d.medical_card_expires < on:
        blocking.append(f"DOT medical card expired {d.medical_card_expires:%d %b}")
    if d.drug_test_due < on:
        blocking.append(f"random drug test overdue since {d.drug_test_due:%d %b}")
    if d.securement_training_due < on:
        wheelchair.append(f"wheelchair securement refresher overdue since {d.securement_training_due:%d %b}")
    return {"safety_id": d.safety_id, "name": d.name, "compliant": not blocking, "blocking": blocking,
            "wheelchair_ok": not blocking and not wheelchair, "wheelchair_reasons": wheelchair, "status": d.status,
            "medical_card_expires": d.medical_card_expires.isoformat(), "drug_test_due": d.drug_test_due.isoformat(),
            "securement_training_due": d.securement_training_due.isoformat(), "preventable_incidents_12m": d.preventable_incidents_12m}


async def list_drivers(s: AsyncSession, tenant_id: str) -> list[SafetyDriver]:
    return list((await s.execute(select(SafetyDriver).where(SafetyDriver.tenant_id == tenant_id).order_by(SafetyDriver.name))).scalars())


async def get_driver(s: AsyncSession, tenant_id: str, safety_id: str) -> SafetyDriver:
    d = await s.get(SafetyDriver, safety_id)
    if not d or d.tenant_id != tenant_id:
        raise ProductAPIError(SYSTEM, "get_driver", "That driver is not in Vestige")
    return d


async def list_defects(s: AsyncSession, tenant_id: str, status: Optional[str] = None, vehicle_ref: Optional[str] = None) -> list[SafetyDefect]:
    q = select(SafetyDefect).where(SafetyDefect.tenant_id == tenant_id)
    if status:
        q = q.where(SafetyDefect.status == status)
    if vehicle_ref:
        q = q.where(SafetyDefect.vehicle_ref == vehicle_ref)
    return list((await s.execute(q.order_by(SafetyDefect.created_at.desc()))).scalars())


async def _next_defect_number(s: AsyncSession) -> str:
    count = (await s.execute(select(func.count()).select_from(SafetyDefect))).scalar_one()
    return f"DEF-{now().year}-{count + 1:05d}"


async def open_defect(s: AsyncSession, tenant_id: str, *, vehicle_ref: str, category: str, severity: str, description: str,
                      source: str = "manual", external_ref: Optional[str] = None, work_order_id: Optional[str] = None,
                      created_by: str = "system") -> SafetyDefect:
    await check_fault(tenant_id, SYSTEM, "open_defect")
    if external_ref:
        existing = (await s.execute(select(SafetyDefect).where(SafetyDefect.tenant_id == tenant_id, SafetyDefect.external_ref == external_ref,
                                                               SafetyDefect.vehicle_ref == vehicle_ref, SafetyDefect.status == "open"))).scalar_one_or_none()
        if existing:
            return existing
    d = SafetyDefect(id=await _next_defect_number(s), tenant_id=tenant_id, vehicle_ref=vehicle_ref, category=category, severity=severity,
                     description=description, status="open", out_of_service=severity in ("critical", "high"), source=source,
                     external_ref=external_ref, work_order_id=work_order_id, created_by=created_by, created_at=now())
    s.add(d)
    await s.flush()
    vid = await identity.to_canonical(s, tenant_id, SYSTEM, vehicle_ref)
    queue_event(s, CloudEvent(type=EventTypes.SAFETY_DEFECT_OPENED, source=SYSTEM, subject=vid, tenantid=tenant_id,
                              data={"defect_id": d.id, "vehicle_ref": vehicle_ref, "category": category, "severity": severity,
                                    "external_ref": external_ref, "manual": source == "manual", "by": created_by}))
    return d


async def close_defect(s: AsyncSession, tenant_id: str, defect_id: str, closed_by: str, resolution: str) -> SafetyDefect:
    await check_fault(tenant_id, SYSTEM, "close_defect")
    d = await s.get(SafetyDefect, defect_id)
    if not d or d.tenant_id != tenant_id:
        raise ProductAPIError(SYSTEM, "close_defect", f"Defect {defect_id} not found")
    if d.status == "closed":
        return d
    d.status, d.closed_at, d.closed_by, d.resolution, d.out_of_service = "closed", now(), closed_by, resolution, False
    vid = await identity.to_canonical(s, tenant_id, SYSTEM, d.vehicle_ref)
    queue_event(s, CloudEvent(type=EventTypes.SAFETY_DEFECT_CLOSED, source=SYSTEM, subject=vid, tenantid=tenant_id,
                              data={"defect_id": d.id, "vehicle_ref": d.vehicle_ref, "external_ref": d.external_ref, "by": closed_by}))
    return d


async def set_compliance(s: AsyncSession, tenant_id: str, safety_id: str, *, issue: str, by: str = "Vestige") -> SafetyDriver:
    """Simulate a compliance lapse (or clear it). issue: medical_card | drug_test | training | suspended | clear."""
    d = await get_driver(s, tenant_id, safety_id)
    today = now().date()
    if issue == "medical_card":
        d.medical_card_expires = today - timedelta(days=1)
    elif issue == "drug_test":
        d.drug_test_due = today - timedelta(days=2)
    elif issue == "training":
        d.securement_training_due = today - timedelta(days=3)
    elif issue == "suspended":
        d.status, d.notes = "suspended", "pending review of a preventable incident"
    elif issue == "clear":
        d.status, d.notes = "compliant", ""
        d.medical_card_expires = max(d.medical_card_expires, today + timedelta(days=365))
        d.drug_test_due = max(d.drug_test_due, today + timedelta(days=90))
        d.securement_training_due = max(d.securement_training_due, today + timedelta(days=180))
    else:
        raise ProductAPIError(SYSTEM, "set_compliance", "issue must be medical_card, drug_test, training, suspended or clear")
    await s.flush()
    cid = await identity.to_canonical(s, tenant_id, SYSTEM, safety_id)
    queue_event(s, CloudEvent(type=EventTypes.DRIVER_COMPLIANCE_CHANGED, source=SYSTEM, subject=cid, tenantid=tenant_id,
                              data={"safety_id": safety_id, "issue": issue, **compliance(d, today), "by": by}))
    return d
