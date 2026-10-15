"""Deterministic analysis the agent reasons over.

Hard constraints (licence, certifications, capacity, wheelchair positions, no
double booking, driver hours) are enforced here in code, never left to the model.
The LLM only explains and may choose among candidates that already passed.
"""
from collections import defaultdict
from datetime import datetime, time, timedelta
from typing import Any, Optional

from app.adapters.base import ActionContext
from app.adapters.registry import adapters
from app.core.clock import now
from app.products.catalog import PM_FAULT_CODE, driver_qualified


def dt(s: str) -> datetime:
    return datetime.fromisoformat(s)


def hm(s: str) -> str:
    d = dt(s)
    return d.strftime("%a %d %b %H:%M")


def _overlaps(a0: datetime, a1: datetime, b0: datetime, b1: datetime) -> bool:
    return a0 < b1 and b0 < a1


async def classify_trigger(ctx: ActionContext, trigger_type: str, trigger: dict, rules: dict) -> dict[str, Any]:
    if trigger_type == "vehicle.pm.overdue":
        over = int(trigger.get("miles_over", 0))
        sev = "high" if over >= rules["thresholds"]["pm_high_severity_miles_over"] else "medium"
        return {"code": PM_FAULT_CODE, "description": f"Preventive maintenance overdue by {over:,} miles", "system": "Maintenance",
                "severity": sev, "est_repair_hours": 4, "affects_accessibility": False}
    code = trigger.get("fault_code", "UNKNOWN")
    fc = await adapters.asset.fault_code(ctx, code)
    if not fc:
        return {"code": code, "description": trigger.get("description", code), "system": "Unknown", "severity": "high",
                "est_repair_hours": 6, "affects_accessibility": False}
    return fc


async def earliest_shop_start(ctx: ActionContext, vehicle_id: str, severity: str) -> tuple[datetime, bool, str]:
    t = now()
    if severity == "critical":
        return t, True, "Critical fault: remove from service now."
    if severity == "high":
        current = [r for r in await adapters.trip.runs_for_vehicle(ctx, vehicle_id, t, t + timedelta(minutes=1))]
        if current:
            end = dt(current[0]["end"])
            return end, True, f"High severity: finish the current run ({current[0]['route_name']}, ends {end:%H:%M}) then go to the shop."
        return t, True, "High severity: send to the shop at the next opportunity."
    nxt = datetime.combine(t.date() + timedelta(days=1), time(7, 0))
    return nxt, False, "Medium or low severity: book the next open shop bay."


def safety_block(d: dict, needs_wheelchair: bool) -> str:
    """Why Vestige says this driver may not take the run ('' when they may). Drivers without a record pass."""
    c = d.get("compliance")
    if not c:
        return ""
    if c.get("blocking"):
        return "Vestige: " + "; ".join(c["blocking"])
    if needs_wheelchair and c.get("wheelchair_reasons"):
        return "Vestige: " + "; ".join(c["wheelchair_reasons"])
    return ""


async def plan_cover(ctx: ActionContext, rules: dict, failed_vehicle_id: str, runs_at_risk: list[dict],
                     drivers: Optional[list[dict]] = None, unsafe_vehicles: Optional[dict[str, list]] = None) -> list[dict]:
    """drivers: the roster from the workforce agent, each optionally carrying Vestige `compliance` from the safety agent.
    unsafe_vehicles: vehicles with open Vestige defects (from the safety agent); they are never offered as a spare."""
    unsafe_vehicles = unsafe_vehicles or {}
    if not runs_at_risk:
        return []
    th = rules["thresholds"]
    exclude_noncompliant = (rules.get("safety") or {}).get("exclude_noncompliant_drivers", True)
    fleet = await adapters.trip.fleet(ctx)
    if drivers is None:
        drivers = await adapters.workforce.drivers(ctx)
    vehicles_by_id = {v["vehicle_id"]: v for v in fleet}
    drivers_by_id = {d["driver_id"]: d for d in drivers}
    failed = vehicles_by_id.get(failed_vehicle_id, {})

    w0 = min(dt(r["start"]) for r in runs_at_risk) - timedelta(hours=14)
    w1 = max(dt(r["end"]) for r in runs_at_risk) + timedelta(hours=14)
    all_runs = await adapters.trip.runs_between(ctx, w0, w1)
    blocks = await adapters.trip.blocks_between(ctx, w0, w1)

    v_busy: dict[str, list[tuple[datetime, datetime]]] = defaultdict(list)
    d_busy: dict[str, list[tuple[datetime, datetime]]] = defaultdict(list)
    d_hours: dict[tuple[str, str], float] = defaultdict(float)
    v_load: dict[tuple[str, str], int] = defaultdict(int)
    at_risk_ids = {r["run_id"] for r in runs_at_risk}
    for r in all_runs:
        s, e = dt(r["start"]), dt(r["end"])
        if r["vehicle_id"] and r["run_id"] not in at_risk_ids:
            v_busy[r["vehicle_id"]].append((s, e))
            v_load[(r["vehicle_id"], r["service_date"])] += 1
        if r["driver_id"]:
            if r["run_id"] not in at_risk_ids:
                d_busy[r["driver_id"]].append((s, e))
            d_hours[(r["driver_id"], r["service_date"])] += (e - s).total_seconds() / 3600
    for b in blocks:
        if b["vehicle_id"]:
            v_busy[b["vehicle_id"]].append((dt(b["start"]), dt(b["end"])))

    proposals = []
    for run in sorted(runs_at_risk, key=lambda r: r["start"]):
        safety_excluded: list[dict] = []
        s, e = dt(run["start"]), dt(run["end"])
        hours = (e - s).total_seconds() / 3600
        day = run["service_date"]

        cands = []
        for v in fleet:
            vid = v["vehicle_id"]
            if vid == failed_vehicle_id or v["status"] == "out_of_service" or vid in unsafe_vehicles:
                continue
            if v["capacity"] < run["riders"]:
                continue
            if run["needs_wheelchair"] and v["wheelchair_positions"] == 0:
                continue
            if any(_overlaps(s, e, b0, b1) for b0, b1 in v_busy[vid]):
                continue
            score, why = 0.0, []
            if v["depot"] == failed.get("depot"):
                score += 30; why.append("same depot")
            if v["vehicle_type"] == failed.get("vehicle_type"):
                score += 20; why.append("same vehicle type")
            score += max(0, 10 - (v["capacity"] - run["riders"]) / 4)
            load = v_load[(vid, day)]
            score -= load * 6
            why.append("idle that day" if load == 0 else f"{load} other run(s) that day")
            cands.append({"vehicle_id": vid, "label": v["label"], "vehicle_type": v["vehicle_type"], "depot": v["depot"],
                          "capacity": v["capacity"], "score": round(score, 1), "reason": ", ".join(why)})
        cands.sort(key=lambda c: -c["score"])
        cands = cands[: int(th["max_spare_candidates"])]
        chosen = cands[0] if cands else None

        driver_choice, driver_cands, keep_driver = None, [], False
        if chosen:
            orig = drivers_by_id.get(run["driver_id"])
            if orig:
                ok, why = driver_qualified(orig["license_class"], orig["certifications"], chosen["vehicle_type"], run["needs_wheelchair"])
                blocked = safety_block(orig, run["needs_wheelchair"]) if exclude_noncompliant else ""
                if ok and blocked:
                    ok, why = False, blocked
                if ok and orig["status"] == "active":
                    driver_choice, keep_driver = orig, True
                    driver_cands.append({"driver_id": orig["driver_id"], "name": orig["name"], "reason": "scheduled driver, qualified for the spare"})
                else:
                    driver_cands.append({"driver_id": orig["driver_id"], "name": orig["name"], "reason": f"scheduled driver not usable: {why}", "eligible": False})
            if not driver_choice:
                pool = []
                for d in drivers:
                    if d["status"] != "active" or not d["driver_id"]:
                        continue
                    ok, _ = driver_qualified(d["license_class"], d["certifications"], chosen["vehicle_type"], run["needs_wheelchair"])
                    if not ok:
                        continue
                    blocked = safety_block(d, run["needs_wheelchair"]) if exclude_noncompliant else ""
                    if blocked:
                        if len(safety_excluded) < 5 and d["driver_id"] not in {x["driver_id"] for x in safety_excluded}:
                            safety_excluded.append({"driver_id": d["driver_id"], "name": d["name"], "reason": blocked})
                        continue
                    if any(_overlaps(s, e, b0, b1) for b0, b1 in d_busy[d["driver_id"]]):
                        continue
                    if d_hours[(d["driver_id"], day)] + hours > d["max_daily_hours"]:
                        continue
                    sc = (20 if d["home_depot"] == chosen["depot"] else 0) - d_hours[(d["driver_id"], day)] * 2
                    pool.append((sc, d))
                pool.sort(key=lambda x: -x[0])
                for sc, d in pool[:3]:
                    driver_cands.append({"driver_id": d["driver_id"], "name": d["name"],
                                         "reason": f"{d['license_class']} licence, {d_hours[(d['driver_id'], day)]:.1f}h worked that day, {d['home_depot']}"})
                driver_choice = pool[0][1] if pool else None

        if chosen:
            v_busy[chosen["vehicle_id"]].append((s, e))
            v_load[(chosen["vehicle_id"], day)] += 1
        if driver_choice and not keep_driver:
            d_busy[driver_choice["driver_id"]].append((s, e))
            d_hours[(driver_choice["driver_id"], day)] += hours

        same_depot = chosen and chosen["depot"] == failed.get("depot")
        delay = int(th["swap_delay_same_depot_min"] if same_depot else th["swap_delay_other_depot_min"]) if chosen else 0
        proposals.append({
            "run_id": run["run_id"], "route_name": run["route_name"], "block_name": run["block_name"], "start": run["start"],
            "end": run["end"], "start_h": hm(run["start"]), "riders": run["riders"], "needs_wheelchair": run["needs_wheelchair"],
            "original_vehicle_id": failed_vehicle_id, "original_driver_id": run["driver_id"],
            "vehicle_id": chosen["vehicle_id"] if chosen else None, "vehicle_label": chosen["label"] if chosen else None,
            "vehicle_type": chosen["vehicle_type"] if chosen else None,
            "driver_id": driver_choice["driver_id"] if driver_choice else None,
            "driver_name": driver_choice["name"] if driver_choice else None, "keep_driver": keep_driver,
            "delay_minutes": delay, "candidates": cands, "driver_candidates": driver_cands, "safety_excluded": safety_excluded,
            "reason": (f"{chosen['label']} ({chosen['reason']})" if chosen else "No spare passes capacity, accessibility and availability checks"),
        })
    return proposals


def out_of_service(earliest: datetime, immediate: bool, window: dict) -> tuple[datetime, datetime]:
    """When the vehicle is off the schedule. Critical and high faults come off now (or after the current run) and stay off
    until the repair is done, even if the first free shop bay is days away; otherwise only for the booked shop visit."""
    shop_from, shop_until = dt(window["start"]), dt(window["end"])
    return (min(earliest, shop_from) if immediate else shop_from), shop_until


async def through_next_block(ctx: ActionContext, rules: dict, vehicle_id: str, start: datetime, end: datetime) -> datetime:
    """A vehicle with an active fault does not go out again until the shop signs it off, so the out-of-service window always
    reaches the end of its next scheduled block, even when the repair is due to finish first (e.g. an overnight repair).
    Dispatch then plans cover for that block instead of hoping the sign-off lands in time."""
    if not rules["thresholds"].get("cover_next_block", True):
        return end
    horizon = now() + timedelta(hours=rules["thresholds"]["service_window_hours"])
    if start >= horizon:
        return end
    upcoming = await adapters.trip.runs_for_vehicle(ctx, vehicle_id, start, horizon)
    nxt = min(upcoming, key=lambda r: dt(r["start"]), default=None)
    return max(end, dt(nxt["end"])) if nxt else end


async def runs_in_window(ctx: ActionContext, rules: dict, vehicle_id: str, start: datetime, end: datetime) -> tuple[list[dict], list[dict]]:
    """Runs inside the out-of-service window, split into (cover now, later runs for the planner)."""
    horizon = now() + timedelta(hours=rules["thresholds"]["service_window_hours"])
    runs = await adapters.trip.runs_for_vehicle(ctx, vehicle_id, start, end)
    return [r for r in runs if dt(r["start"]) < horizon], [r for r in runs if dt(r["start"]) >= horizon]


async def assess(ctx: ActionContext, rules: dict, vehicle_id: str, trigger_type: str, trigger: dict) -> dict[str, Any]:
    fault = await classify_trigger(ctx, trigger_type, trigger, rules)
    vehicle = await adapters.trip.vehicle(ctx, vehicle_id)
    health = await adapters.asset.vehicle_health(ctx, vehicle_id)
    earliest, immediate, timing_reason = await earliest_shop_start(ctx, vehicle_id, fault["severity"])
    window = await adapters.asset.find_shop_window(ctx, vehicle_id, earliest, int(fault["est_repair_hours"]), immediate)
    oos_from, oos_until = out_of_service(earliest, immediate, window)
    oos_until = await through_next_block(ctx, rules, vehicle_id, oos_from, oos_until)
    at_risk, later = await runs_in_window(ctx, rules, vehicle_id, oos_from, oos_until)
    proposals = await plan_cover(ctx, rules, vehicle_id, at_risk)
    return {
        "severity": fault["severity"], "fault": fault, "vehicle": vehicle, "health": health, "timing_reason": timing_reason,
        "oos_from": oos_from.isoformat(), "oos_until": oos_until.isoformat(), "shop_from": window["start"], "shop_until": window["end"],
        "pull_now": immediate, "depot": window["depot"],
        "runs_at_risk": at_risk, "later_runs": later, "proposals": proposals,
    }


def priority_for(severity: str) -> str:
    return {"critical": "critical", "high": "high", "medium": "medium"}.get(severity, "low")


RIDER_TEMPLATES = {
    "en": {
        "delay": "TransitTech: your {time} pickup at {stop} is now expected at {eta} (about {mins} min later) because of a vehicle change. Your ride is still confirmed.",
        "change": "TransitTech: your {time} pickup at {stop} is on time. You will be picked up by vehicle {vehicle}.",
    },
    "es": {
        "delay": "TransitTech: su recogida de las {time} en {stop} ahora se espera a las {eta} (unos {mins} min más tarde) por un cambio de vehículo. Su viaje sigue confirmado.",
        "change": "TransitTech: su recogida de las {time} en {stop} está a tiempo. Lo recogerá el vehículo {vehicle}.",
    },
    "zh": {
        "delay": "TransitTech：由于更换车辆，您在{stop}的{time}接载预计改为{eta}（约晚{mins}分钟）。您的行程仍然有效。",
        "change": "TransitTech：您在{stop}的{time}接载准时。将由{vehicle}号车辆接您。",
    },
}


def rider_message(lang: str, delayed: bool, **kw: Any) -> str:
    tpl = RIDER_TEMPLATES.get(lang, RIDER_TEMPLATES["en"])
    return tpl["delay" if delayed else "change"].format(**kw)
