"""Rolling schedule: keeps synthetic runs and trips on the calendar as days pass.

The seed writes runs for yesterday through two days ahead, once, on the day the database is created. Without this the
Schedule page runs dry a day or two later. On start and then hourly, every missing day in that window is filled by
copying the agency's daily timetable (the most recent seeded day, with its original vehicle and driver, before any
reassignment), and runs and trips whose time has passed move to in progress / completed.
"""
import asyncio
import random
from datetime import date, datetime, timedelta

from sqlalchemy import select, update

from app.core.clock import new_id, now
from app.core.database import session_scope
from app.core.logging import get_logger
from app.models import CanonicalEntity, Rider, Run, Tenant, Trip, TripRequest
from app.seed.extras import PURPOSES
from app.seed.generator import _xw

log = get_logger("rolling_schedule")
DAYS_BACK, DAYS_AHEAD = 1, 2  # the Schedule page shows yesterday through two days ahead
INTERVAL_SECONDS = 900  # every 15 min, so a new day is on the calendar soon after midnight


def _status(start: datetime, end: datetime, t_now: datetime) -> str:
    return "completed" if end < t_now else "in_progress" if start <= t_now else "scheduled"


def _with_date(ident: str, sep: str, pos: int, day: date) -> str:
    """Swap the MMDD part of a seeded id (RUN-MVT-1014-201-AM, trp_mvt_1014_201AM_00) for another day's."""
    parts = ident.split(sep)
    parts[pos] = f"{day:%m%d}"
    return sep.join(parts)


async def _fill_day(s, tid: str, template: date, day: date, riders: list[str]) -> tuple[int, int]:
    rng = random.Random(f"{tid}-{day.isoformat()}")  # same day, same data, however often it runs
    t_now = now()
    shift = day - template
    runs = (await s.execute(select(Run).where(Run.tenant_id == tid, Run.service_date == template).order_by(Run.start_time))).scalars().all()
    n_trips = 0
    for r in runs:
        rid = _with_date(r.id, "-", 2, day)
        start, end = r.start_time + shift, r.end_time + shift
        s.add(Run(id=rid, tenant_id=tid, service_date=day, route_name=r.route_name, block_name=r.block_name, start_time=start, end_time=end,
                  vehicle_code=r.original_vehicle_code or r.vehicle_code, driver_code=r.original_driver_code or r.driver_code,
                  status=_status(start, end, t_now)))
        for t in (await s.execute(select(Trip).where(Trip.run_id == r.id).order_by(Trip.pickup_time))).scalars():
            if f"_{template:%m%d}_" not in t.id:
                continue  # a standby rider booked onto that day's run, not part of the timetable
            trid = _with_date(t.id, "_", 2, day)
            pickup = t.pickup_time + shift
            s.add(Trip(id=trid, tenant_id=tid, run_id=rid, rider_id=rng.choice(riders), pickup_time=pickup, eta=pickup,
                       pickup_stop=t.pickup_stop, dropoff_stop=t.dropoff_stop, needs_wheelchair=t.needs_wheelchair,
                       status="completed" if pickup < t_now - timedelta(minutes=30) else "booked"))
            s.add(CanonicalEntity(id=trid, tenant_id=tid, entity_type="trip", label=f"{rid} #{int(trid.rsplit('_', 1)[1]) + 1}"))
            s.add(_xw(tid, "trip", trid, "trip_mgmt", trid))
            n_trips += 1
        if end > t_now:  # standby waitlist, as the seed does for upcoming runs
            for _ in range(rng.choice([0, 1, 1, 2])):
                span = (end - start).total_seconds() / 60
                w0 = start + timedelta(minutes=int(rng.uniform(15, max(16, span - 60))))
                s.add(TripRequest(id=new_id("req"), tenant_id=tid, rider_id=rng.choice(riders), service_date=day, route_name=r.route_name,
                                  window_start=w0, window_end=w0 + timedelta(minutes=rng.choice([45, 60, 75])),
                                  pickup_stop=f"{rng.randint(100, 2999)} {rng.choice(['Oak', 'Elm', 'Harbor', 'Valley', 'Pine', 'Market'])} Ave",
                                  dropoff_stop=rng.choice(["Medical Center", "Dialysis Clinic", "Senior Center", "Shopping Plaza", "VA Clinic"]),
                                  purpose=rng.choices(PURPOSES[0], weights=PURPOSES[1])[0], needs_wheelchair=rng.random() < 0.15,
                                  status="waiting", created_at=t_now - timedelta(hours=rng.randint(2, 72))))
    return len(runs), n_trips


async def roll_schedule() -> dict:
    """Fill missing days in the window and move past runs and trips along. Safe to run any number of times."""
    today = now().date()
    window = [today + timedelta(days=d) for d in range(-DAYS_BACK, DAYS_AHEAD + 1)]
    added: dict = {}
    async with session_scope() as s:
        for tid in (await s.execute(select(Tenant.id))).scalars().all():
            have = set((await s.execute(select(Run.service_date).where(Run.tenant_id == tid).distinct())).scalars())
            missing = [d for d in window if d not in have]
            if not have or not missing:
                continue
            template = max(have)
            riders = list((await s.execute(select(Rider.id).where(Rider.tenant_id == tid))).scalars())
            for day in missing:
                runs, trips = await _fill_day(s, tid, template, day, riders)
                added[f"{tid} {day}"] = {"runs": runs, "trips": trips}
        t_now = now()
        await s.execute(update(Run).where(Run.status.in_(["scheduled", "in_progress"]), Run.end_time < t_now).values(status="completed"))
        await s.execute(update(Run).where(Run.status == "scheduled", Run.start_time <= t_now, Run.end_time >= t_now).values(status="in_progress"))
        await s.execute(update(Trip).where(Trip.status == "booked", Trip.pickup_time < t_now - timedelta(minutes=30)).values(status="completed"))
        await s.execute(update(TripRequest).where(TripRequest.status == "waiting", TripRequest.window_end < t_now).values(status="expired"))
    if added:
        log.info("Rolling schedule added %s", added)
    return added


class ScheduleRoller:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._loop(), name="rolling-schedule")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None

    async def _loop(self) -> None:
        while True:
            try:
                await roll_schedule()
            except Exception:  # never let the loop die
                log.exception("rolling schedule failed")
            await asyncio.sleep(INTERVAL_SECONDS)


roller = ScheduleRoller()
