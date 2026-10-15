"""Synthetic FASTER (asset management): assets, work orders, shop capacity, PM tracking."""
import math
from datetime import datetime, time, timedelta
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import new_id, now
from app.core.errors import ProductAPIError
from app.core.events import CloudEvent, EventTypes
from app.identity.service import identity
from app.models import Asset, FaultCode, ShopCapacity, WorkOrder
from app.products.common import check_fault, queue_event

SYSTEM = "asset_mgmt"


async def get_asset(s: AsyncSession, tenant_id: str, asset_number: str) -> Asset:
    a = await s.get(Asset, asset_number)
    if not a or a.tenant_id != tenant_id:
        raise ProductAPIError(SYSTEM, "get_asset", "That vehicle is not in asset management")
    return a


async def list_assets(s: AsyncSession, tenant_id: str) -> list[Asset]:
    return list((await s.execute(select(Asset).where(Asset.tenant_id == tenant_id).order_by(Asset.unit_label))).scalars())


async def fault_code(s: AsyncSession, code: str) -> Optional[FaultCode]:
    return await s.get(FaultCode, code)


async def list_fault_codes(s: AsyncSession) -> list[FaultCode]:
    return list((await s.execute(select(FaultCode).order_by(FaultCode.severity, FaultCode.code))).scalars())


async def shop_capacity(s: AsyncSession, tenant_id: str, days: int = 4) -> list[ShopCapacity]:
    """Bays per depot and day, from today (agency time) for `days` days."""
    start = now().date()
    q = select(ShopCapacity).where(ShopCapacity.tenant_id == tenant_id, ShopCapacity.day >= start,
                                   ShopCapacity.day < start + timedelta(days=days))
    return list((await s.execute(q.order_by(ShopCapacity.day, ShopCapacity.depot))).scalars())


async def list_work_orders(s: AsyncSession, tenant_id: str, status: Optional[str] = None, asset_number: Optional[str] = None) -> list[WorkOrder]:
    q = select(WorkOrder).where(WorkOrder.tenant_id == tenant_id)
    if status:
        q = q.where(WorkOrder.status.in_(status.split(",")))
    if asset_number:
        q = q.where(WorkOrder.asset_number == asset_number)
    return list((await s.execute(q.order_by(WorkOrder.created_at.desc()))).scalars())


async def get_work_order(s: AsyncSession, tenant_id: str, wo_id: str) -> WorkOrder:
    wo = await s.get(WorkOrder, wo_id)
    if not wo or wo.tenant_id != tenant_id:
        raise ProductAPIError(SYSTEM, "get_work_order", f"Work order {wo_id} not found")
    return wo


async def open_work_orders_for_asset(s: AsyncSession, tenant_id: str, asset_number: str) -> list[WorkOrder]:
    return await list_work_orders(s, tenant_id, "open,in_progress", asset_number)


def pm_miles_over(a: Asset) -> int:
    return (a.odometer - a.last_pm_odometer) - a.pm_interval_miles


async def pm_overdue_assets(s: AsyncSession, tenant_id: str) -> list[Asset]:
    return [a for a in await list_assets(s, tenant_id) if a.status == "active" and pm_miles_over(a) >= 0]


def repair_duration(hours: int) -> timedelta:
    """Shop time including prep: under a shift stays same-day, longer spills over days."""
    if hours <= 8:
        return timedelta(hours=hours + 2)
    return timedelta(days=math.ceil(hours / 8))


async def find_shop_window(
    s: AsyncSession, tenant_id: str, depot: str, earliest: datetime, est_hours: int, immediate: bool
) -> tuple[datetime, datetime, str]:
    """First day from `earliest` with a free bay at the depot. Returns (start, end, depot)."""
    day = earliest.date()
    for _ in range(14):
        cap = (
            await s.execute(select(ShopCapacity).where(ShopCapacity.tenant_id == tenant_id, ShopCapacity.depot == depot, ShopCapacity.day == day))
        ).scalar_one_or_none()
        if cap is None or cap.bays_booked < cap.bays_total:
            if immediate and day == earliest.date():
                start = earliest
            else:
                start = max(earliest, datetime.combine(day, time(7, 0)))
            return start, start + repair_duration(est_hours), depot
        day += timedelta(days=1)
    start = datetime.combine(day, time(7, 0))
    return start, start + repair_duration(est_hours), depot


async def _book_bay(s: AsyncSession, tenant_id: str, depot: str, day, delta: int) -> None:
    cap = (
        await s.execute(select(ShopCapacity).where(ShopCapacity.tenant_id == tenant_id, ShopCapacity.depot == depot, ShopCapacity.day == day))
    ).scalar_one_or_none()
    if cap:
        cap.bays_booked = max(0, cap.bays_booked + delta)


async def _next_wo_number(s: AsyncSession, tenant_id: str) -> str:
    count = (await s.execute(select(func.count()).select_from(WorkOrder))).scalar_one()
    return f"WO-{now().year}-{count + 1:05d}"


async def create_work_order(
    s: AsyncSession,
    tenant_id: str,
    *,
    asset_number: str,
    priority: str,
    title: str,
    description: str = "",
    fault_code: Optional[str] = None,
    shop_depot: Optional[str] = None,
    shop_start: Optional[datetime] = None,
    shop_end: Optional[datetime] = None,
    source: str = "manual",
    external_ref: Optional[str] = None,
    created_by: str = "system",
) -> WorkOrder:
    await check_fault(tenant_id, SYSTEM, "create_work_order")
    asset = await get_asset(s, tenant_id, asset_number)
    wo = WorkOrder(
        id=await _next_wo_number(s, tenant_id), tenant_id=tenant_id, asset_number=asset_number, status="open",
        priority=priority, fault_code=fault_code, title=title, description=description, source=source,
        shop_depot=shop_depot or asset.depot, shop_start=shop_start, shop_end=shop_end, external_ref=external_ref,
        created_by=created_by, created_at=now(),
    )
    s.add(wo)
    if shop_start:
        await _book_bay(s, tenant_id, wo.shop_depot, shop_start.date(), +1)
    await s.flush()
    vehicle_id = await identity.to_canonical(s, tenant_id, SYSTEM, asset_number)
    queue_event(s, CloudEvent(type=EventTypes.WORK_ORDER_CREATED, source=SYSTEM, subject=vehicle_id, tenantid=tenant_id,
                              data={"work_order_id": wo.id, "asset_number": asset_number, "priority": priority, "external_ref": external_ref,
                                    "source": source, "by": created_by}))
    return wo


async def start_work_order(s: AsyncSession, tenant_id: str, wo_id: str, by: str) -> WorkOrder:
    wo = await get_work_order(s, tenant_id, wo_id)
    if wo.status != "open":
        raise ProductAPIError(SYSTEM, "start_work_order", f"Work order is {wo.status}")
    wo.status = "in_progress"
    asset = await get_asset(s, tenant_id, wo.asset_number)
    asset.status = "in_shop"
    return wo


async def close_work_order(s: AsyncSession, tenant_id: str, wo_id: str, closed_by: str, resolution: str) -> WorkOrder:
    await check_fault(tenant_id, SYSTEM, "close_work_order")
    wo = await get_work_order(s, tenant_id, wo_id)
    if wo.status in ("closed", "cancelled"):
        raise ProductAPIError(SYSTEM, "close_work_order", f"Work order is already {wo.status}")
    if wo.status != "in_progress":
        raise ProductAPIError(SYSTEM, "close_work_order", "Start work on this work order before closing it")
    wo.status = "closed"
    wo.closed_at = now()
    wo.closed_by = closed_by
    wo.resolution = resolution
    asset = await get_asset(s, tenant_id, wo.asset_number)
    asset.status = "active"
    if wo.fault_code == "PM-DUE":
        asset.last_pm_date = now().date()
        asset.last_pm_odometer = asset.odometer
    vehicle_id = await identity.to_canonical(s, tenant_id, SYSTEM, wo.asset_number)
    queue_event(s, CloudEvent(type=EventTypes.WORK_ORDER_CLOSED, source=SYSTEM, subject=vehicle_id, tenantid=tenant_id,
                              data={"work_order_id": wo.id, "asset_number": wo.asset_number, "closed_by": closed_by,
                                    "resolution": resolution, "external_ref": wo.external_ref},
                              dedupekey=f"wo-closed:{wo.id}"))
    return wo


async def cancel_work_order(s: AsyncSession, tenant_id: str, wo_id: str, reason: str, by: str = "system") -> WorkOrder:
    wo = await get_work_order(s, tenant_id, wo_id)
    if wo.status in ("closed", "cancelled"):
        return wo
    wo.status = "cancelled"
    wo.closed_at = now()
    wo.closed_by = by
    wo.resolution = f"Cancelled: {reason}"
    if wo.shop_start:
        await _book_bay(s, tenant_id, wo.shop_depot, wo.shop_start.date(), -1)
    asset = await get_asset(s, tenant_id, wo.asset_number)
    if asset.status == "in_shop":
        asset.status = "active"
    vehicle_id = await identity.to_canonical(s, tenant_id, SYSTEM, wo.asset_number)
    queue_event(s, CloudEvent(type=EventTypes.WORK_ORDER_CANCELLED, source=SYSTEM, subject=vehicle_id, tenantid=tenant_id,
                              data={"work_order_id": wo.id, "reason": reason, "external_ref": wo.external_ref}))
    return wo


async def set_asset_status(s: AsyncSession, tenant_id: str, asset_number: str, status: str) -> Asset:
    a = await get_asset(s, tenant_id, asset_number)
    a.status = status
    return a


async def flag_pm_overdue(s: AsyncSession, tenant_id: str, asset: Asset) -> None:
    vehicle_id = await identity.to_canonical(s, tenant_id, SYSTEM, asset.asset_number)
    over = pm_miles_over(asset)
    queue_event(s, CloudEvent(
        type=EventTypes.VEHICLE_PM_OVERDUE, source=SYSTEM, subject=vehicle_id, tenantid=tenant_id,
        data={"asset_number": asset.asset_number, "unit_label": asset.unit_label, "odometer": asset.odometer,
              "miles_over": over, "last_pm_date": asset.last_pm_date.isoformat(), "pm_interval_miles": asset.pm_interval_miles},
        dedupekey=f"pm:{asset.asset_number}:{asset.last_pm_odometer}",
    ))
