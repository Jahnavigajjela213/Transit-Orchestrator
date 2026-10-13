from datetime import date
from typing import Optional

from fastapi import APIRouter
from sqlalchemy import func, select

from app.api.deps import CurrentUser, SessionDep
from app.core.clock import now
from app.models import CanonicalEntity, Crosswalk, FleetVehicle, Run, Trip, TripDriver

router = APIRouter(prefix="/api/schedule", tags=["schedule (unified view)"])


@router.get("")
async def schedule(user: CurrentUser, s: SessionDep, service_date: Optional[date] = None, only_changed: bool = False):
    tid = user.tenant_id
    d = service_date or now().date()
    q = select(Run).where(Run.tenant_id == tid, Run.service_date == d)
    if only_changed:
        q = q.where(Run.reassigned.is_(True))
    runs = (await s.execute(q.order_by(Run.start_time, Run.block_name))).scalars().all()
    labels = {v.vehicle_code: v.label for v in (await s.execute(select(FleetVehicle).where(FleetVehicle.tenant_id == tid))).scalars()}
    drivers = {dr.driver_code: dr.name for dr in (await s.execute(select(TripDriver).where(TripDriver.tenant_id == tid))).scalars()}
    counts = dict((await s.execute(select(Trip.run_id, func.count()).where(Trip.tenant_id == tid, Trip.run_id.in_([r.id for r in runs]))
                                   .group_by(Trip.run_id))).all())
    standby = dict((await s.execute(select(Trip.run_id, func.count()).where(Trip.tenant_id == tid, Trip.run_id.in_([r.id for r in runs]),
                                                                            Trip.source_ref.is_not(None), Trip.status == "booked").group_by(Trip.run_id))).all())
    wc = dict((await s.execute(select(Trip.run_id, func.count()).where(Trip.tenant_id == tid, Trip.run_id.in_([r.id for r in runs]),
                                                                       Trip.needs_wheelchair.is_(True)).group_by(Trip.run_id))).all())
    return {
        "service_date": d.isoformat(),
        "runs": [{
            "run_id": r.id, "route_name": r.route_name, "block_name": r.block_name, "start": r.start_time, "end": r.end_time, "status": r.status,
            "vehicle_label": labels.get(r.vehicle_code), "driver_name": drivers.get(r.driver_code),
            "original_vehicle_label": labels.get(r.original_vehicle_code) if r.reassigned else None,
            "original_driver_name": drivers.get(r.original_driver_code) if r.reassigned and r.original_driver_code != r.driver_code else None,
            "reassigned": r.reassigned, "workflow_id": r.reassignment_ref, "riders": counts.get(r.id, 0), "wheelchair_riders": wc.get(r.id, 0),
            "delay_minutes": r.delay_minutes, "standby_riders": standby.get(r.id, 0),
        } for r in runs],
    }
