"""Synthetic Ecolane / TripMaster (trip management): vehicles, availability, runs, trips."""
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import new_id, now
from app.core.errors import ProductAPIError
from app.core.events import CloudEvent, EventTypes
from app.identity.service import identity
from app.models import AvailabilityBlock, FleetVehicle, NoShowLog, Rider, Run, Trip, TripDriver, TripRequest
from app.products.common import check_fault, queue_event

SYSTEM = "trip_mgmt"


# Messages people read name things the way a dispatcher does: vehicle number, route and block with its time, driver and
# rider names. Internal codes (TM-…, RUN-…, trp_…) stay out of them.
def run_name(r: Run) -> str:
    return f"{r.route_name} {r.block_name} ({r.start_time:%a %d %b %H:%M})"


async def vehicle_name(s: AsyncSession, code: str) -> str:
    v = await s.get(FleetVehicle, code)
    return v.label if v else "the vehicle"


async def driver_name(s: AsyncSession, code: str) -> str:
    d = await s.get(TripDriver, code)
    return d.name if d else "the driver"


async def trip_name(s: AsyncSession, t: Trip) -> str:
    rider = await s.get(Rider, t.rider_id)
    return f"{rider.name if rider else 'the rider'}'s {t.pickup_time:%H:%M} pickup"


async def get_vehicle(s: AsyncSession, tenant_id: str, code: str) -> FleetVehicle:
    v = await s.get(FleetVehicle, code)
    if not v or v.tenant_id != tenant_id:
        raise ProductAPIError(SYSTEM, "get_vehicle", "That vehicle is not in trip management")
    return v


async def list_vehicles(s: AsyncSession, tenant_id: str) -> list[FleetVehicle]:
    return list((await s.execute(select(FleetVehicle).where(FleetVehicle.tenant_id == tenant_id).order_by(FleetVehicle.label))).scalars())


async def list_drivers(s: AsyncSession, tenant_id: str) -> list[TripDriver]:
    return list((await s.execute(select(TripDriver).where(TripDriver.tenant_id == tenant_id))).scalars())


async def get_run(s: AsyncSession, tenant_id: str, run_id: str) -> Run:
    r = await s.get(Run, run_id)
    if not r or r.tenant_id != tenant_id:
        raise ProductAPIError(SYSTEM, "get_run", "That run is not in trip management")
    return r


async def list_runs(s: AsyncSession, tenant_id: str, service_date: Optional[date] = None, vehicle_code: Optional[str] = None) -> list[Run]:
    q = select(Run).where(Run.tenant_id == tenant_id)
    if service_date:
        q = q.where(Run.service_date == service_date)
    if vehicle_code:
        q = q.where(Run.vehicle_code == vehicle_code)
    return list((await s.execute(q.order_by(Run.start_time, Run.route_name))).scalars())


async def runs_between(s: AsyncSession, tenant_id: str, start: datetime, end: datetime) -> list[Run]:
    q = select(Run).where(Run.tenant_id == tenant_id, Run.start_time < end, Run.end_time > start, Run.status != "cancelled")
    return list((await s.execute(q.order_by(Run.start_time))).scalars())


async def runs_for_vehicle_between(s: AsyncSession, tenant_id: str, code: str, start: datetime, end: datetime) -> list[Run]:
    q = select(Run).where(
        Run.tenant_id == tenant_id, Run.vehicle_code == code, Run.start_time < end, Run.end_time > start,
        Run.status.in_(["scheduled", "in_progress"]),
    )
    return list((await s.execute(q.order_by(Run.start_time))).scalars())


async def active_blocks(s: AsyncSession, tenant_id: str, start: Optional[datetime] = None, end: Optional[datetime] = None) -> list[AvailabilityBlock]:
    q = select(AvailabilityBlock).where(AvailabilityBlock.tenant_id == tenant_id, AvailabilityBlock.active.is_(True))
    if start and end:
        q = q.where(AvailabilityBlock.start < end, AvailabilityBlock.end > start)
    return list((await s.execute(q)).scalars())


async def vehicle_is_free(s: AsyncSession, tenant_id: str, code: str, start: datetime, end: datetime, ignore_run: Optional[str] = None) -> tuple[bool, str]:
    blocks = [b for b in await active_blocks(s, tenant_id, start, end) if b.vehicle_code == code]
    if blocks:
        return False, f"blocked: {blocks[0].reason}"
    clash = [r for r in await runs_for_vehicle_between(s, tenant_id, code, start, end) if r.id != ignore_run]
    if clash:
        return False, f"already on {run_name(clash[0])}"
    return True, "free"


async def driver_runs_between(s: AsyncSession, tenant_id: str, driver_code: str, start: datetime, end: datetime) -> list[Run]:
    q = select(Run).where(
        Run.tenant_id == tenant_id, Run.driver_code == driver_code, Run.start_time < end, Run.end_time > start,
        Run.status.in_(["scheduled", "in_progress"]),
    )
    return list((await s.execute(q)).scalars())


async def driver_runs_on(s: AsyncSession, tenant_id: str, driver_code: str, day: date) -> list[Run]:
    q = select(Run).where(Run.tenant_id == tenant_id, Run.driver_code == driver_code, Run.service_date == day, Run.status != "cancelled")
    return list((await s.execute(q)).scalars())


async def block_vehicle(s: AsyncSession, tenant_id: str, code: str, start: datetime, end: datetime, reason: str, source_ref: str,
                        by: Optional[str] = None) -> AvailabilityBlock:
    await check_fault(tenant_id, SYSTEM, "block_vehicle")
    v = await get_vehicle(s, tenant_id, code)
    existing = (
        await s.execute(select(AvailabilityBlock).where(AvailabilityBlock.source_ref == source_ref, AvailabilityBlock.active.is_(True)))
    ).scalar_one_or_none()
    if existing:
        return existing
    blk = AvailabilityBlock(id=new_id("blk"), tenant_id=tenant_id, vehicle_code=code, start=start, end=end, reason=reason, source_ref=source_ref)
    s.add(blk)
    if start <= now():
        v.status = "out_of_service"
    await s.flush()
    vid = await identity.to_canonical(s, tenant_id, SYSTEM, code)
    queue_event(s, CloudEvent(type=EventTypes.VEHICLE_AVAILABILITY_CHANGED, source=SYSTEM, subject=vid, tenantid=tenant_id,
                              data={"vehicle_code": code, "available": False, "from": start.isoformat(), "until": end.isoformat(), "reason": reason, "ref": source_ref,
                                    "by": by, "manual": source_ref.startswith("manual:")}))
    return blk


async def unblock_vehicle(s: AsyncSession, tenant_id: str, source_ref: str, reason: str, by: Optional[str] = None) -> Optional[AvailabilityBlock]:
    await check_fault(tenant_id, SYSTEM, "unblock_vehicle")
    blk = (
        await s.execute(select(AvailabilityBlock).where(AvailabilityBlock.tenant_id == tenant_id, AvailabilityBlock.source_ref == source_ref, AvailabilityBlock.active.is_(True)))
    ).scalar_one_or_none()
    if not blk:
        return None
    blk.active = False
    if blk.end > now():
        blk.end = max(blk.start, now())
    v = await get_vehicle(s, tenant_id, blk.vehicle_code)
    remaining = [b for b in await active_blocks(s, tenant_id, now(), now()) if b.vehicle_code == v.vehicle_code and b.id != blk.id]
    if not remaining:
        v.status = "available"
    vid = await identity.to_canonical(s, tenant_id, SYSTEM, blk.vehicle_code)
    queue_event(s, CloudEvent(type=EventTypes.VEHICLE_AVAILABILITY_CHANGED, source=SYSTEM, subject=vid, tenantid=tenant_id,
                              data={"vehicle_code": blk.vehicle_code, "available": True, "reason": reason, "ref": source_ref, "by": by,
                                    "manual": bool(by) and not source_ref.startswith("wf_")}))
    return blk


async def mark_available_by_hand(s: AsyncSession, tenant_id: str, code: str, by: str) -> FleetVehicle:
    """A dispatcher confirms in the schedule that a vehicle with no availability block is back in service."""
    await check_fault(tenant_id, SYSTEM, "unblock_vehicle")
    v = await get_vehicle(s, tenant_id, code)
    v.status = "available"
    vid = await identity.to_canonical(s, tenant_id, SYSTEM, code)
    queue_event(s, CloudEvent(type=EventTypes.VEHICLE_AVAILABILITY_CHANGED, source=SYSTEM, subject=vid, tenantid=tenant_id,
                              data={"vehicle_code": code, "available": True, "reason": "Returned to service by dispatcher",
                                    "ref": f"manual:{new_id('rts')}", "by": by, "manual": True}))
    return v


async def assign_run(s: AsyncSession, tenant_id: str, run_id: str, vehicle_code: str, driver_code: str, ref: str, by: Optional[str] = None) -> Run:
    await check_fault(tenant_id, SYSTEM, "assign_run")
    run = await get_run(s, tenant_id, run_id)
    if run.reassignment_ref == ref and run.vehicle_code == vehicle_code and run.driver_code == driver_code:
        return run  # idempotent replay
    free, why = await vehicle_is_free(s, tenant_id, vehicle_code, run.start_time, run.end_time, ignore_run=run.id)
    if not free:
        raise ProductAPIError(SYSTEM, "assign_run", f"{await vehicle_name(s, vehicle_code)} is not free for {run_name(run)}: it is {why}")
    if driver_code != run.driver_code:
        clash = [r for r in await driver_runs_between(s, tenant_id, driver_code, run.start_time, run.end_time) if r.id != run.id]
        if clash:
            raise ProductAPIError(SYSTEM, "assign_run", f"{await driver_name(s, driver_code)} already drives {run_name(clash[0])}")
    if not run.reassigned:
        run.original_vehicle_code = run.vehicle_code
        run.original_driver_code = run.driver_code
    run.vehicle_code = vehicle_code
    run.driver_code = driver_code
    run.reassigned = True
    run.reassignment_ref = ref
    await s.flush()
    queue_event(s, CloudEvent(type=EventTypes.RUN_REASSIGNED, source=SYSTEM, tenantid=tenant_id,
                              data={"run_id": run.id, "vehicle_code": vehicle_code, "driver_code": driver_code, "ref": ref, "by": by,
                                    "manual": ref.startswith("manual:")}))
    return run


async def revert_run(s: AsyncSession, tenant_id: str, run_id: str) -> Run:
    run = await get_run(s, tenant_id, run_id)
    if run.reassigned:
        run.vehicle_code = run.original_vehicle_code
        run.driver_code = run.original_driver_code
        run.reassigned = False
        run.reassignment_ref = None
    return run


async def trips_for_runs(s: AsyncSession, tenant_id: str, run_ids: list[str]) -> list[Trip]:
    if not run_ids:
        return []
    q = select(Trip).where(Trip.tenant_id == tenant_id, Trip.run_id.in_(run_ids), Trip.status == "booked")
    return list((await s.execute(q.order_by(Trip.pickup_time))).scalars())


async def update_trip_eta(s: AsyncSession, tenant_id: str, trip_id: str, eta: datetime) -> Trip:
    t = await s.get(Trip, trip_id)
    if not t or t.tenant_id != tenant_id:
        raise ProductAPIError(SYSTEM, "update_trip_eta", "That pickup is not in trip management")
    t.eta = eta
    return t


async def get_trip(s: AsyncSession, tenant_id: str, trip_id: str) -> Trip:
    t = await s.get(Trip, trip_id)
    if not t or t.tenant_id != tenant_id:
        raise ProductAPIError(SYSTEM, "get_trip", "That pickup is not in trip management")
    return t


async def run_trips(s: AsyncSession, tenant_id: str, run_id: str, statuses: tuple[str, ...] = ("booked",)) -> list[Trip]:
    q = select(Trip).where(Trip.tenant_id == tenant_id, Trip.run_id == run_id, Trip.status.in_(statuses))
    return list((await s.execute(q.order_by(Trip.pickup_time))).scalars())


async def mark_no_show(s: AsyncSession, tenant_id: str, trip_id: str, kind: str = "no_show") -> Trip:
    """Driver records a no-show, or the rider cancels late. Publishes trip.no_show / trip.cancelled."""
    t = await get_trip(s, tenant_id, trip_id)
    if t.status != "booked":
        raise ProductAPIError(SYSTEM, "mark_no_show", f"{(await trip_name(s, t)).capitalize()} is {t.status.replace('_', ' ')}, not booked")
    t.status = "no_show" if kind == "no_show" else "cancelled"
    run = await get_run(s, tenant_id, t.run_id)
    s.add(NoShowLog(id=new_id("nsl"), tenant_id=tenant_id, rider_id=t.rider_id, trip_id=t.id, service_date=run.service_date, kind=kind))
    etype = EventTypes.TRIP_NO_SHOW if kind == "no_show" else EventTypes.TRIP_CANCELLED
    trip_cid = await identity.to_canonical(s, tenant_id, SYSTEM, t.id)
    queue_event(s, CloudEvent(type=etype, source=SYSTEM, subject=trip_cid, tenantid=tenant_id, dedupekey=f"noshow:{t.id}",
                              data={"trip_id": t.id, "run_id": t.run_id, "rider_id": t.rider_id, "kind": kind,
                                    "pickup_time": t.pickup_time.isoformat(), "pickup_stop": t.pickup_stop}))
    return t


async def rider_no_show_count(s: AsyncSession, tenant_id: str, rider_id: str, days: int = 30) -> int:
    since = now().date() - timedelta(days=days)
    q = select(NoShowLog).where(NoShowLog.tenant_id == tenant_id, NoShowLog.rider_id == rider_id, NoShowLog.service_date >= since)
    return len((await s.execute(q)).scalars().all())


async def waitlist_candidates(s: AsyncSession, tenant_id: str, run: Run, start: datetime, end: datetime) -> list[TripRequest]:
    q = select(TripRequest).where(
        TripRequest.tenant_id == tenant_id, TripRequest.status == "waiting", TripRequest.service_date == run.service_date,
        TripRequest.route_name == run.route_name, TripRequest.window_start < end, TripRequest.window_end > start,
    )
    return list((await s.execute(q.order_by(TripRequest.created_at))).scalars())


async def list_requests(s: AsyncSession, tenant_id: str, service_date: Optional[date] = None, status: Optional[str] = None) -> list[TripRequest]:
    q = select(TripRequest).where(TripRequest.tenant_id == tenant_id)
    if service_date:
        q = q.where(TripRequest.service_date == service_date)
    if status:
        q = q.where(TripRequest.status.in_(status.split(",")))
    return list((await s.execute(q.order_by(TripRequest.window_start))).scalars())


async def book_request(s: AsyncSession, tenant_id: str, request_id: str, run_id: str, pickup_time: datetime, ref: str) -> Trip:
    await check_fault(tenant_id, SYSTEM, "book_request")
    req = await s.get(TripRequest, request_id)
    if not req or req.tenant_id != tenant_id:
        raise ProductAPIError(SYSTEM, "book_request", "That standby request is not in trip management")
    if req.status == "booked" and req.booked_trip_id:
        return await get_trip(s, tenant_id, req.booked_trip_id)  # idempotent replay
    if req.status != "waiting":
        raise ProductAPIError(SYSTEM, "book_request", f"That standby request is already {req.status}")
    run = await get_run(s, tenant_id, run_id)
    v = await get_vehicle(s, tenant_id, run.vehicle_code)
    booked = await run_trips(s, tenant_id, run_id)
    if len(booked) >= v.capacity:
        raise ProductAPIError(SYSTEM, "book_request", f"{v.label} is full on {run_name(run)}")
    if req.needs_wheelchair and sum(1 for t in booked if t.needs_wheelchair) >= v.wheelchair_positions:
        raise ProductAPIError(SYSTEM, "book_request", f"No free wheelchair position on {v.label}")
    t = Trip(id=new_id("trp"), tenant_id=tenant_id, run_id=run_id, rider_id=req.rider_id, pickup_time=pickup_time, eta=pickup_time,
             pickup_stop=req.pickup_stop, dropoff_stop=req.dropoff_stop, needs_wheelchair=req.needs_wheelchair, status="booked", source_ref=ref)
    s.add(t)
    req.status = "booked"
    req.booked_trip_id = t.id
    await s.flush()
    queue_event(s, CloudEvent(type=EventTypes.TRIP_BOOKED, source=SYSTEM, tenantid=tenant_id,
                              data={"trip_id": t.id, "run_id": run_id, "request_id": request_id, "ref": ref}))
    return t


async def cancel_booking(s: AsyncSession, tenant_id: str, request_id: str) -> Optional[Trip]:
    req = await s.get(TripRequest, request_id)
    if not req or req.tenant_id != tenant_id or not req.booked_trip_id:
        return None
    t = await s.get(Trip, req.booked_trip_id)
    if t:
        t.status = "cancelled"
    req.status = "waiting"
    req.booked_trip_id = None
    return t
