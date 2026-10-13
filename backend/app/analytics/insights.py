"""Descriptive insights and model-scored what-if levers for on-time performance (OTP).

OTP here = share of completed pickups that were on time (within the agency's window).
"""
import copy
import hashlib
from collections import defaultdict
from datetime import timedelta
from typing import Any, Callable

from app.analytics.model import LateModel

BASELINE_DAYS = 30


def otp(rows: list[dict]) -> float | None:
    n = sum(r["completed_trips"] for r in rows)
    return round(100 * sum(r["on_time_pickups"] for r in rows) / n, 2) if n else None


def window(rows: list[dict], days: int, offset: int = 0) -> list[dict]:
    if not rows:
        return []
    last = max(r["service_date"] for r in rows)
    end = last - timedelta(days=offset)
    start = end - timedelta(days=days - 1)
    return [r for r in rows if start <= r["service_date"] <= end]


def group(rows: list[dict], key: str | Callable[[dict], str]) -> list[dict]:
    f = key if callable(key) else (lambda r: r[key])
    g: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        g[f(r)].append(r)
    out = []
    for k, rs in g.items():
        late = sum(r["late_pickups"] for r in rs)
        out.append({"key": k, "otp": otp(rs), "runs": len(rs), "pickups": sum(r["completed_trips"] for r in rs), "late_pickups": late,
                    "avg_late_min": round(sum(r["avg_late_min"] * r["late_pickups"] for r in rs) / late, 1) if late else 0.0,
                    "recovery_min": round(sum(r["recovery_min"] for r in rs) / len(rs), 1),
                    "dwell_min": round(sum(r["avg_dwell_min"] for r in rs) / len(rs), 2),
                    "load_factor": round(sum(r["load_factor"] for r in rs) / len(rs), 2),
                    "no_show_rate": round(100 * sum(r["no_shows"] for r in rs) / max(1, sum(r["scheduled_trips"] for r in rs)), 1)})
    return sorted(out, key=lambda x: (x["otp"] if x["otp"] is not None else 101))


def summary(rows: list[dict]) -> dict[str, Any]:
    base = window(rows, BASELINE_DAYS)
    prior = window(rows, BASELINE_DAYS, offset=BASELINE_DAYS)
    weekly = defaultdict(list)
    for r in rows:
        wk = r["service_date"] - timedelta(days=r["service_date"].weekday())
        weekly[wk].append(r)
    drivers = [d for d in group(window(rows, 60), lambda r: f"{r['driver_id']}|{r['driver_name']}|{r['tenure_band']}") if d["runs"] >= 15]
    for d in drivers:
        did, name, tb = d.pop("key").split("|")
        d.update(driver_id=did, driver_name=name, tenure_band=tb)
    pm_rows, ok_rows = [r for r in base if r["pm_overdue"]], [r for r in base if not r["pm_overdue"]]
    return {
        "otp_30d": otp(base), "otp_prior_30d": otp(prior), "runs_30d": len(base), "pickups_30d": sum(r["completed_trips"] for r in base),
        "late_pickups_30d": sum(r["late_pickups"] for r in base),
        "no_shows_30d": sum(r["no_shows"] for r in base), "late_cancels_30d": sum(r["late_cancels"] for r in base),
        "no_show_rate_30d": round(100 * sum(r["no_shows"] for r in base) / max(1, sum(r["scheduled_trips"] for r in base)), 1),
        "road_calls_30d": sum(1 for r in base if r["road_call"]),
        "otp_when_pm_overdue": otp(pm_rows), "otp_when_pm_current": otp(ok_rows), "runs_pm_overdue_30d": len(pm_rows),
        "history_days": (max(r["service_date"] for r in rows) - min(r["service_date"] for r in rows)).days + 1 if rows else 0,
        "history_runs": len(rows),
        "weekly": [{"week": wk.isoformat(), "otp": otp(rs), "runs": len(rs)} for wk, rs in sorted(weekly.items())],
        "by_route": group(base, "route_name"), "by_band": group(base, "hour_band"), "by_weather": group(base, "weather"),
        "by_tenure": group(base, "tenure_band"), "by_dow": group(base, "dow_name"),
        "coaching_candidates": drivers[:8], "drivers_ranked": len(drivers),
    }


# ---------------------------------------------------------------- levers
def _stable(r: dict, salt: str) -> float:
    return int(hashlib.sha1(f"{r['id']}{salt}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def _worst_routes(base: list[dict], k: int = 3) -> list[str]:
    return [g["key"] for g in group(base, "route_name")[:k]]


def lever_defs(base: list[dict]) -> list[dict]:
    worst = _worst_routes(base)
    low_recovery = [g["key"] for g in group(base, "route_name") if g["key"] in worst and g["recovery_min"] < 8]
    dwell_routes = [g["key"] for g in group(base, "route_name") if g["dwell_min"] > 3.0]
    days = len({r["service_date"] for r in base}) or 1

    def recovery(rows):
        n = 0
        for r in rows:
            if r["route_name"] in low_recovery:
                r["recovery_min"] += 4
                n += 1
        return n, f"~{round(n * 4 / 60 / days, 1)} extra platform hours per day"

    def pairing(rows):
        n = 0
        for r in rows:
            if r["route_name"] in worst and r["tenure_band"] == "under 1 year":
                r["tenure_band"] = "3+ years"
                n += 1
        return n, "No extra hours; changes the next operator bid"

    def pm(rows):
        n = 0
        for r in rows:
            if r["pm_overdue"]:
                r["pm_overdue"] = 0.0
                if r["road_call"] and _stable(r, "pm") < 0.6:
                    r["road_call"] = 0.0
                n += 1
        return n, "Uses the vehicle health orchestration to keep PM on schedule"

    def noshow(rows):
        n = 0
        for r in rows:
            if r["no_shows"]:
                r["no_shows"] = r["no_shows"] * 0.7
                n += 1
        return n, "Reminder calls plus the no-show recovery agent"

    def peak(rows):
        n = 0
        for r in rows:
            if r["hour_band"] == "pm_peak" and r["load_factor"] > 0.85:
                r["load_factor"] = 0.85
                n += 1
        return n, f"~{max(1, round(n / days))} tripper run(s) per weekday"

    def dwell(rows):
        n = 0
        for r in rows:
            if r["route_name"] in dwell_routes:
                r["avg_dwell_min"] = max(1.5, r["avg_dwell_min"] - 0.8)
                n += 1
        return n, "Securement refresher training and pre-boarding at clinics"

    return [
        {"key": "recovery_time", "name": "Add recovery time on the routes that run latest", "effort": "medium", "fn": recovery,
         "detail": f"+4 min recovery per block on {', '.join(low_recovery) or 'no route (recovery already adequate)'}", "applies": bool(low_recovery)},
        {"key": "pm_compliance", "name": "Keep every vehicle on its maintenance schedule", "effort": "low", "fn": pm,
         "detail": "No vehicle runs past its PM interval; fewer breakdowns mid-run", "applies": any(r["pm_overdue"] for r in base)},
        {"key": "operator_pairing", "name": "Put experienced operators on the hardest routes", "effort": "low", "fn": pairing,
         "detail": f"Operators under 1 year move off {', '.join(worst)}", "applies": True},
        {"key": "dwell_reduction", "name": "Cut dwell time at medical and dialysis stops", "effort": "medium", "fn": dwell,
         "detail": f"-0.8 min average dwell on {', '.join(dwell_routes) or 'no route'}", "applies": bool(dwell_routes)},
        {"key": "peak_relief", "name": "Relieve crowding on the busiest PM runs", "effort": "high", "fn": peak,
         "detail": "Cap PM peak load factor at 85% with tripper runs", "applies": any(r["hour_band"] == "pm_peak" and r["load_factor"] > 0.85 for r in base)},
        {"key": "no_show_reduction", "name": "Reduce no-shows by 30%", "effort": "low", "fn": noshow,
         "detail": "Fewer wasted waits at the curb", "applies": any(r["no_shows"] for r in base)},
    ]


EFFORT_RANK = {"low": 0, "medium": 1, "high": 2}


def plan(model: LateModel, rows: list[dict], target: float | None = None) -> dict[str, Any]:
    base = window(rows, BASELINE_DAYS)
    actual = otp(base) or 0.0
    predicted_base = model.predicted_otp(base)
    offset = actual - predicted_base  # calibrate scenarios to the observed baseline
    levers = []
    for d in lever_defs(base):
        if not d["applies"]:
            continue
        scenario = copy.deepcopy(base)
        affected, cost = d["fn"](scenario)
        if not affected:
            continue
        gain = model.predicted_otp(scenario) - predicted_base
        levers.append({"key": d["key"], "name": d["name"], "detail": d["detail"], "effort": d["effort"], "cost_note": cost,
                       "runs_affected": affected, "uplift_pp": round(gain, 2)})
    levers.sort(key=lambda x: (-x["uplift_pp"], EFFORT_RANK[x["effort"]]))
    defs = {d["key"]: d for d in lever_defs(base)}
    target = target if target is not None else round(actual + 2.0, 1)
    steps, scenario, reached = [], copy.deepcopy(base), actual >= target
    for lv in levers:
        if reached or lv["uplift_pp"] <= 0.02:
            break
        defs[lv["key"]]["fn"](scenario)
        cum = model.predicted_otp(scenario) + offset
        steps.append({**lv, "cumulative_otp": round(cum, 2)})
        reached = cum >= target
    best_possible = model.predicted_otp(_all_levers(base, defs, levers)) + offset if levers else actual
    return {"current_otp": round(actual, 2), "target_otp": target, "reached": reached, "levers": levers, "plan": steps,
            "projected_otp": steps[-1]["cumulative_otp"] if steps else round(actual, 2),
            "max_with_all_levers": round(best_possible, 2), "calibration_offset_pp": round(offset, 2),
            "baseline_days": BASELINE_DAYS, "baseline_runs": len(base)}


def _all_levers(base: list[dict], defs: dict, levers: list[dict]) -> list[dict]:
    s = copy.deepcopy(base)
    for lv in levers:
        defs[lv["key"]]["fn"](s)
    return s
