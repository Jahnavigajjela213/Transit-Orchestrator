"""Synthetic data for No-Show Recovery and the Operator Performance SLM.

Generated after the core seed, from the same vehicles, drivers, routes and riders:
  - driver hire dates (newer operators cluster on the hardest routes, as in real bids)
  - live run delays for today and tomorrow
  - a standby waitlist of trip requests per run
  - 120 days of run-level operations history (the Databricks feature table stand-in)
  - a 30-day no-show log, with a small group of riders causing many of the no-shows

The history has known causes of lateness built in (peak hours, weather, crowding, low
recovery time, long dwell at clinics, new operators, overdue maintenance, breakdowns), so
the model should rediscover them and the levers should rank sensibly.
"""
import math
from datetime import date, timedelta

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import new_id, now
from app.models import Crosswalk, Employee, FleetVehicle, NoShowLog, OpsRunHistory, Rider, Run, TripDriver, TripRequest

HISTORY_DAYS = 120

# route: (late-risk effect on the logit scale, recovery minutes, dwell minutes per stop)
ROUTE_PROFILE = {
    "Route 9 Medical Ctr": (0.30, 5.0, 3.7), "Route 4 Airport": (0.45, 4.5, 2.4), "Route 22 Eastgate": (0.20, 7.0, 2.6),
    "Route 40 Express": (-0.25, 10.0, 1.9), "Route 2 Crosstown": (0.10, 7.5, 2.5), "Flex Zone North": (0.05, 9.0, 2.9),
    "ADA Zone C": (0.35, 5.0, 3.0), "Dialysis Shuttle": (0.30, 5.5, 4.2), "Medical Express": (0.15, 7.0, 3.4),
    "Lakeshore Connector": (-0.10, 10.0, 2.4),
}
DEFAULT_PROFILE = (0.0, 9.0, 2.5)
PROBLEM = {k for k, v in ROUTE_PROFILE.items() if v[0] >= 0.25}
TENANT_BASE = {"ten_mvt": -4.05, "ten_lsp": -3.6}
NO_SHOW_RATE = {"ten_mvt": 0.05, "ten_lsp": 0.075}
WEATHER = (["clear", "rain", "fog", "heat"], [0.70, 0.17, 0.06, 0.07])
WEATHER_EFFECT = {"clear": 0.0, "rain": 0.5, "fog": 0.35, "heat": 0.15}
BAND_EFFECT = {"am_peak": 0.25, "midday": 0.0, "pm_peak": 0.55}
DOW_EFFECT = {0: 0.08, 4: 0.12}
PURPOSES = (["medical", "work", "standard"], [0.35, 0.25, 0.40])


def _band(route: str, block: str, routes: list[str]) -> str:
    if block == "AM":
        return "am_peak"
    return "pm_peak" if routes.index(route) % 2 == 0 else "midday"


async def seed_extras(s: AsyncSession, tenant_ids: list[str], seed: int = 42) -> dict:
    rng = np.random.default_rng(seed + 7)
    today = now().date()
    stats = {}
    for tid in tenant_ids:
        fleet = {v.vehicle_code: v for v in (await s.execute(select(FleetVehicle).where(FleetVehicle.tenant_id == tid))).scalars()}
        tdrivers = {d.driver_code: d for d in (await s.execute(select(TripDriver).where(TripDriver.tenant_id == tid))).scalars()}
        xw = (await s.execute(select(Crosswalk).where(Crosswalk.tenant_id == tid, Crosswalk.entity_type == "driver"))).scalars().all()
        canon_by_trip = {x.external_id: x.canonical_id for x in xw if x.system == "trip_mgmt"}
        emp_by_canon = {x.canonical_id: x.external_id for x in xw if x.system == "workforce"}
        employees = {e.employee_number: e for e in (await s.execute(select(Employee).where(Employee.tenant_id == tid))).scalars()}
        today_runs = (await s.execute(select(Run).where(Run.tenant_id == tid, Run.service_date == today).order_by(Run.start_time))).scalars().all()
        routes = sorted({r.route_name for r in today_runs})

        # ---- hire dates: problem routes get more new operators
        slot_driver_routes = {r.driver_code: r.route_name for r in today_runs}
        for code, emp_no in ((c, emp_by_canon.get(canon_by_trip.get(c))) for c in tdrivers):
            e = employees.get(emp_no)
            if not e:
                continue
            route = slot_driver_routes.get(code)
            p_new = 0.5 if route in PROBLEM else 0.18 if route else 0.3
            years = float(rng.uniform(0.15, 0.95)) if rng.random() < p_new else float(rng.uniform(1.0, 18.0))
            e.hire_date = today - timedelta(days=int(years * 365))

        # ---- live delays for today and tomorrow
        future = (await s.execute(select(Run).where(Run.tenant_id == tid, Run.service_date >= today, Run.status != "completed"))).scalars().all()
        for r in future:
            r.delay_minutes = int(rng.choice([0, 0, 0, 0, 4, 7, 12, 16, 22]))
            if r.route_name in PROBLEM and rng.random() < 0.4:
                r.delay_minutes += 8

        # ---- standby waitlist: 0-2 requests per upcoming run, windows inside the run
        riders = [rid for (rid,) in (await s.execute(select(Rider.id).where(Rider.tenant_id == tid))).all()]
        nreq = 0
        for r in future:
            for _ in range(int(rng.choice([0, 1, 1, 2]))):
                span = (r.end_time - r.start_time).total_seconds() / 60
                start = r.start_time + timedelta(minutes=int(rng.uniform(15, max(16, span - 60))))
                s.add(TripRequest(id=new_id("req"), tenant_id=tid, rider_id=str(rng.choice(riders)), service_date=r.service_date,
                                  route_name=r.route_name, window_start=start, window_end=start + timedelta(minutes=int(rng.choice([45, 60, 75]))),
                                  pickup_stop=f"{int(rng.integers(100, 2999))} {rng.choice(['Oak', 'Elm', 'Harbor', 'Valley', 'Pine', 'Market'])} Ave",
                                  dropoff_stop=str(rng.choice(["Medical Center", "Dialysis Clinic", "Senior Center", "Shopping Plaza", "VA Clinic"])),
                                  purpose=str(rng.choice(PURPOSES[0], p=PURPOSES[1])), needs_wheelchair=bool(rng.random() < 0.15),
                                  status="waiting", created_at=now() - timedelta(hours=int(rng.integers(2, 72)))))
                nreq += 1

        # ---- 120 days of run history
        weather_by_day = {}
        prev = "clear"
        for d in range(HISTORY_DAYS, 0, -1):
            day = today - timedelta(days=d)
            w = prev if (prev != "clear" and rng.random() < 0.45) else str(rng.choice(WEATHER[0], p=WEATHER[1]))
            weather_by_day[day] = prev = w
        overdue_until: dict[str, date] = {}
        rows, ns_rows = [], []
        rider_weights = rng.pareto(1.6, len(riders)) + 0.2
        rider_weights /= rider_weights.sum()
        for d in range(HISTORY_DAYS, 0, -1):
            day = today - timedelta(days=d)
            dow = day.weekday()
            days_ago = d
            for r in today_runs:
                if dow >= 5 and rng.random() < 0.4:
                    continue  # lighter weekend service
                v = fleet.get(r.vehicle_code)
                drv = tdrivers.get(r.driver_code)
                if not v or not drv:
                    continue
                emp = employees.get(emp_by_canon.get(canon_by_trip.get(r.driver_code)))
                hire = emp.hire_date if emp and emp.hire_date else today - timedelta(days=1500)
                tenure = max(0.05, (day - hire).days / 365)
                block = "AM" if r.block_name.endswith("AM") else "PM"
                band = _band(r.route_name, block, routes)
                eff, rec_base, dwell_base = ROUTE_PROFILE.get(r.route_name, DEFAULT_PROFILE)
                # maintenance streaks: a vehicle sometimes runs past its PM interval for a while
                if overdue_until.get(v.vehicle_code, date.min) < day and rng.random() < 0.018:
                    overdue_until[v.vehicle_code] = day + timedelta(days=int(rng.integers(4, 14)))
                pm_overdue = overdue_until.get(v.vehicle_code, date.min) >= day
                road_call = bool(rng.random() < (0.006 + (0.05 if pm_overdue else 0.0)))
                lo, hi = {"40ft Bus": (10, 22), "35ft Bus": (8, 18), "Cutaway": (5, 12), "Paratransit Van": (3, 7)}[v.vehicle_type]
                sched = int(rng.integers(lo, hi + 1))
                no_shows = int(rng.binomial(sched, NO_SHOW_RATE[tid]))
                late_cancels = int(rng.binomial(sched - no_shows, 0.03))
                completed = sched - no_shows - late_cancels
                wc = int(rng.binomial(completed, 0.22 if v.vehicle_type == "Paratransit Van" else 0.06))
                mult = 2.4 if "Bus" in v.vehicle_type else 1.0
                growth = 1 + 0.07 * (1 - days_ago / HISTORY_DAYS)
                load = float(np.clip(completed * mult / v.capacity * growth + (0.12 if band == "pm_peak" else 0) + rng.normal(0, 0.06), 0.15, 1.25))
                recovery = float(max(2.0, rec_base + rng.normal(0, 0.8)))
                dwell = float(max(1.2, dwell_base + 0.08 * wc + rng.normal(0, 0.25)))
                tenure_eff = 0.6 if tenure < 1 else 0.2 if tenure < 3 else 0.0
                logit = (TENANT_BASE[tid] + eff + BAND_EFFECT[band] + WEATHER_EFFECT[weather_by_day[day]] + 1.1 * (load - 0.6)
                         - 0.13 * (recovery - 8) + 0.40 * (dwell - 2.5) + tenure_eff + (0.45 if pm_overdue else 0) + (1.7 if road_call else 0)
                         + 0.05 * no_shows + DOW_EFFECT.get(dow, 0) + rng.normal(0, 0.15))
                p = 1 / (1 + math.exp(-logit))
                late = int(rng.binomial(completed, p))
                avg_late = float(max(3.0, 6 + 14 * p + rng.normal(0, 2))) if late else 0.0
                rows.append(OpsRunHistory(
                    id=f"h_{tid[-3:]}_{day:%Y%m%d}_{r.block_name}", tenant_id=tid, service_date=day, dow=dow, route_name=r.route_name,
                    block=block, hour_band=band, depot=v.depot, vehicle_label=v.label, vehicle_type=v.vehicle_type,
                    driver_id=canon_by_trip.get(r.driver_code, r.driver_code), driver_name=drv.name, driver_tenure_years=round(tenure, 2),
                    weather=weather_by_day[day], scheduled_trips=sched, completed_trips=completed, no_shows=no_shows, late_cancels=late_cancels,
                    wheelchair_boardings=wc, load_factor=round(load, 3), recovery_min=round(recovery, 1), avg_dwell_min=round(dwell, 2),
                    pm_overdue=pm_overdue, road_call=road_call, on_time_pickups=completed - late, late_pickups=late, avg_late_min=round(avg_late, 1),
                ))
                if d <= 30:
                    for kind, n in (("no_show", no_shows), ("late_cancel", late_cancels)):
                        for _ in range(n):
                            ns_rows.append(NoShowLog(id=new_id("nsl"), tenant_id=tid, rider_id=str(rng.choice(riders, p=rider_weights)),
                                                     service_date=day, kind=kind))
        s.add_all(rows)
        s.add_all(ns_rows)
        await s.flush()
        stats[tid] = {"history_rows": len(rows), "no_show_log": len(ns_rows), "standby_requests": nreq}
    return stats
