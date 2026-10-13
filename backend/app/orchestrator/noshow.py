"""No-Show Recovery workflow (Phase 2 of the proposal).

Trigger: trip.no_show or trip.cancelled from trip management.
Reuses the event backbone, the policy engine and the trip management adapter.

  1 Detect -> 2 Assess -> 3 Adjust schedule (gate) -> 4 Notify riders (gate) -> 5 Log recovery

Assessment works out how many minutes the missed pickup frees, then picks one of:
  insert      book a waiting standby rider into the gap (capacity recovered)
  resequence  move later pickups earlier, because the run is running behind (on-time protected)
  hold        nothing useful to change; log it
Hard checks (seat and wheelchair capacity, pickup window, extra minutes allowed) are code, not model.
"""
import hashlib
from datetime import datetime, timedelta
from typing import Any, Optional

from langgraph.graph import END, START, StateGraph

from app.adapters.registry import adapters
from app.core.clock import now
from app.core.database import SessionLocal
from app.core.errors import PolicyViolation, ProductAPIError
from app.core.logging import get_logger
from app.llm.router import llm
from app.models import Rider
from app.orchestrator.assessment import dt, hm
from app.agents import supervisor
from app.orchestrator.graph import GO, _approved_by, _audit, _decision, _delegate, _read, _rules, make_gate
from app.orchestrator.state import NoShowState
from app.orchestrator.tracking import set_step, update_workflow

log = get_logger("orchestrator.noshow")
WORKFLOW_TYPE = "no_show_recovery"


def _detour_minutes(request_id: str) -> int:
    """Synthetic extra driving to add a pickup (4-12 min), stable per request. Real: routing engine."""
    return 4 + int(hashlib.sha1(request_id.encode()).hexdigest(), 16) % 9


async def _rider_names(ids: list[str]) -> dict[str, dict]:
    out = {}
    async with SessionLocal() as s:
        for rid in set(ids):
            r = await s.get(Rider, rid)
            if r:
                out[rid] = {"name": r.name, "language": r.language, "channel": r.preferred_channel}
    return out


def _current_eta(t: dict, delay: int) -> datetime:
    return max(dt(t["eta"]), dt(t["pickup_time"]) + timedelta(minutes=delay))


def compute_plan(run: dict, missed: dict, saved: int, mode: str, candidate: Optional[dict], th: dict, names: dict) -> dict[str, Any]:
    """ETA changes for the downstream pickups under one mode."""
    pickup = dt(missed["pickup_time"])
    delay = int(run.get("delay_minutes") or 0)
    late_thr = timedelta(minutes=th["late_threshold_min"])
    downstream = [t for t in run["trips"] if dt(t["pickup_time"]) > pickup]
    if mode == "insert" and candidate:
        shift = candidate["detour_min"] - saved  # positive = later
    elif mode == "resequence":
        shift = -saved
    else:
        shift = 0
    changes, late_before, late_after = [], 0, 0
    for t in downstream:
        before = _current_eta(t, delay)
        after = max(dt(t["pickup_time"]), before + timedelta(minutes=shift))
        lb, la = before > dt(t["pickup_time"]) + late_thr, after > dt(t["pickup_time"]) + late_thr
        late_before += lb
        late_after += la
        change = int((after - before).total_seconds() // 60)
        changes.append({"trip_id": t["trip_id"], "rider_id": t["rider_id"], "rider_name": names.get(t["rider_id"], {}).get("name", t["rider_id"]),
                        "pickup_time": t["pickup_time"], "pickup_stop": t["pickup_stop"], "eta_before": before.isoformat(),
                        "eta_after": after.isoformat(), "change_min": change, "late_before": lb, "late_after": la})
    return {"mode": mode, "shift_min": shift, "changes": changes, "late_before": late_before, "late_after": late_after,
            "moved": sum(1 for c in changes if c["change_min"] != 0), "candidate": candidate if mode == "insert" else None}


async def assess(ctx, rules: dict, trigger: dict) -> dict[str, Any]:
    th = rules["thresholds"]
    missed = await adapters.trip.get_trip(ctx, trigger["trip_id"])
    run = await adapters.trip.run_detail(ctx, trigger["run_id"])
    kind = trigger.get("kind", "no_show")
    saved = int(th["no_show_minutes_saved"] if kind == "no_show" else th["late_cancel_minutes_saved"])
    pickup = dt(missed["pickup_time"])
    names = await _rider_names([t["rider_id"] for t in run["trips"]] + [missed["rider_id"]])

    seats_free = run["capacity"] - len(run["trips"])
    wc_free = run["wheelchair_positions"] - sum(1 for t in run["trips"] if t["needs_wheelchair"])
    window_start, window_end = pickup - timedelta(minutes=10), pickup + timedelta(minutes=saved + 20)
    raw = await adapters.trip.waitlist_candidates(ctx, run["run_id"], window_start, window_end)
    candidates, rejected = [], []
    for q in raw:
        detour = _detour_minutes(q["request_id"])
        proposed = min(max(pickup + timedelta(minutes=2), dt(q["window_start"])), dt(q["window_end"]))
        why_not = None
        if seats_free <= 0:
            why_not = "no free seat"
        elif q["needs_wheelchair"] and wc_free <= 0:
            why_not = "no free wheelchair position"
        elif detour - saved > th["max_insert_extra_min"]:
            why_not = f"adds {detour - saved} min to later pickups (limit {th['max_insert_extra_min']})"
        entry = {**q, "detour_min": detour, "proposed_pickup": proposed.isoformat(), "net_change_min": detour - saved,
                 "score": (30 if q["purpose"] == "medical" else 15 if q["purpose"] == "work" else 0) - max(0, detour - saved) * 2}
        (rejected if why_not else candidates).append({**entry, "why_not": why_not} if why_not else entry)
    candidates.sort(key=lambda x: (-x["score"], x["requested_at"]))
    candidates = candidates[: int(th["max_standby_candidates"])]

    delay = int(run.get("delay_minutes") or 0)
    downstream = [t for t in run["trips"] if dt(t["pickup_time"]) > pickup]
    resequence_helps = any(_current_eta(t, delay) > dt(t["pickup_time"]) for t in downstream)
    if candidates and delay <= th["late_threshold_min"]:
        mode, reason = "insert", f"Run is {'on time' if delay == 0 else f'{delay} min behind, within the {th['late_threshold_min']} min window'}; use the freed seat for a standby rider."
    elif resequence_helps:
        mode, reason = "resequence", f"Run is {delay} min behind; use the {saved} freed minutes to bring later pickups closer to schedule."
    else:
        mode, reason = "hold", "No standby rider fits and later pickups are already on time; record the no-show only."
    plan = compute_plan(run, missed, saved, mode, candidates[0] if candidates else None, th, names)
    alt_modes = [m for m in ("insert", "resequence", "hold") if m != "insert" or candidates]
    if not downstream:
        alt_modes = [m for m in alt_modes if m != "resequence"]
    count = await adapters.trip.rider_no_show_count(ctx, missed["rider_id"], 30)
    return {
        "kind": kind, "missed": {**missed, "rider_name": names.get(missed["rider_id"], {}).get("name", missed["rider_id"])},
        "run": {k: v for k, v in run.items() if k != "trips"}, "riders_on_run": len(run["trips"]), "minutes_saved": saved,
        "seats_free": seats_free, "wheelchair_free": wc_free, "candidates": candidates, "rejected_candidates": rejected[:5],
        "mode": mode, "reason": reason, "plan": plan, "alt_modes": alt_modes, "downstream_count": len(downstream),
        "rider_no_shows_30d": count, "flag_rider": count >= th["no_show_review_threshold_30d"], "severity": None,
    }


# ---------------------------------------------------------------- nodes
async def assess_node(state: NoShowState) -> dict:
    await set_step(state["workflow_id"], "detect", "done", f"{state['trigger'].get('kind', 'no_show').replace('_', ' ').capitalize()} recorded", "autonomous")
    await set_step(state["workflow_id"], "assess", "active", "Evaluating freed time, standby riders and later pickups", "autonomous")
    rules = await _rules(state)
    a = await _read(state, rules, "trip", "assess_no_show", lambda ctx: assess(ctx, rules, state["trigger"]))
    p = a["plan"]
    res = await llm.run("assess_noshow", {
        "kind": a["kind"], "route": a["run"]["route_name"], "block": a["run"]["block_name"], "vehicle": a["run"]["vehicle_label"],
        "pickup_time": hm(a["missed"]["pickup_time"]), "rider": a["missed"]["rider_name"], "minutes_saved": a["minutes_saved"],
        "delay": a["run"]["delay_minutes"], "mode": a["mode"], "reason": a["reason"], "moved": p["moved"],
        "late_before": p["late_before"], "late_after": p["late_after"],
        "candidate": {k: p["candidate"][k] for k in ("rider_name", "purpose", "pickup_stop", "detour_min")} if p["candidate"] else None,
        "rider_no_shows_30d": a["rider_no_shows_30d"], "flag_rider": a["flag_rider"],
    }, tenant_id=state["tenant_id"], workflow_id=state["workflow_id"])
    a["summary"], a["model"] = res.text, res.model
    await _audit(state, record_type="assessment", step="assess", autonomy_level="autonomous", model_used=res.model,
                 data_considered={"missed_trip": a["missed"], "run": a["run"], "standby_candidates": a["candidates"],
                                  "rejected_candidates": a["rejected_candidates"], "rider_no_shows_30d": a["rider_no_shows_30d"]},
                 recommendation={"mode": a["mode"], "minutes_saved": a["minutes_saved"], "late_before": p["late_before"],
                                 "late_after": p["late_after"], "moved": p["moved"]},
                 outcome="assessed", explanation=a["summary"], input_tokens=res.input_tokens, output_tokens=res.output_tokens)
    title = f"{'No-show' if a['kind'] == 'no_show' else 'Late cancellation'} on {a['run']['route_name']} {a['run']['block_name']}"
    await set_step(state["workflow_id"], "assess", "done", f"{a['minutes_saved']} min freed, plan: {a['mode']}", "autonomous",
                   title=title, summary=a["summary"], context={"assessment": a, "agent_plan": supervisor.plan(WORKFLOW_TYPE)})
    return {"assessment": a}


def _skip(state: NoShowState, step: str) -> str:
    a = state["assessment"]
    if step == "adjust_schedule" and a["mode"] == "hold":
        return "Nothing to adjust: " + a["reason"]
    if step == "notify_riders":
        adj = state.get("adjustment") or {}
        if not adj:
            return "Schedule was not changed"
        if not adj.get("booked") and not any(abs(c["change_min"]) >= adj.get("notify_threshold", 3) for c in adj.get("changes", [])):
            return "No rider's pickup changed enough to notify"
    return ""


def _recommend(state: NoShowState, step: str) -> dict:
    a = state["assessment"]
    if step == "adjust_schedule":
        p = a["plan"]
        return {"mode": a["mode"], "reason": a["reason"], "minutes_saved": a["minutes_saved"], "run": a["run"],
                "missed": a["missed"], "candidate": p["candidate"], "changes": p["changes"], "late_before": p["late_before"],
                "late_after": p["late_after"], "flag_rider": a["flag_rider"], "rider_no_shows_30d": a["rider_no_shows_30d"]}
    if step == "notify_riders":
        adj = state.get("adjustment") or {}
        return {"booked": adj.get("booked"), "changes": len(adj.get("changes", []))}
    return {}


def _options(state: NoShowState, step: str) -> dict:
    a = state["assessment"]
    if step == "adjust_schedule":
        return {"modes": a["alt_modes"], "candidates": a["candidates"]}
    return {}


async def exec_adjust(state: NoShowState) -> dict:
    a, d = state["assessment"], _decision(state, "adjust_schedule")
    rules = await _rules(state)
    th = rules["thresholds"]
    ov = d.get("override") or {}
    mode = ov.get("mode") or a["mode"]
    candidate = None
    if mode == "insert":
        rid = ov.get("request_id") or (a["plan"]["candidate"] or {}).get("request_id")
        candidate = next((c for c in a["candidates"] if c["request_id"] == rid), None)
        if not candidate:
            mode = "resequence" if "resequence" in a["alt_modes"] else "hold"
    if mode == "hold":
        await set_step(state["workflow_id"], "adjust_schedule", "skipped", "Person chose to record the no-show only")
        return {"adjustment": {}}
    done: list[dict] = []
    undone: list[str] = []
    out: dict = {}

    async def apply(ctx) -> None:
        run = await adapters.trip.run_detail(ctx, a["run"]["run_id"])  # fresh read: trips may have changed
        names = await _rider_names([t["rider_id"] for t in run["trips"]])
        plan = compute_plan(run, a["missed"], a["minutes_saved"], mode, candidate, th, names)
        out.update(run=run, plan=plan, booked=None)
        try:
            if mode == "insert":
                out["booked"] = await adapters.trip.book_request(ctx, request_id=candidate["request_id"], run_id=run["run_id"],
                                                                 pickup_time=dt(candidate["proposed_pickup"]), ref=state["workflow_id"],
                                                                 idempotency_key=f"{state['workflow_id']}:book:{candidate['request_id']}")
                done.append({"action": "book_request", "request_id": candidate["request_id"]})
            for ch in plan["changes"]:
                if ch["change_min"] != 0:
                    await adapters.trip.update_trip_eta(ctx, trip_id=ch["trip_id"], eta=dt(ch["eta_after"]),
                                                        idempotency_key=f"{state['workflow_id']}:eta:{ch['trip_id']}")
                    done.append({"action": "update_trip_eta", "trip_id": ch["trip_id"], "eta_before": ch["eta_before"]})
        except (ProductAPIError, PolicyViolation):
            for act in reversed(done):
                try:
                    if act["action"] == "update_trip_eta":
                        await adapters.trip.update_trip_eta(ctx, trip_id=act["trip_id"], eta=dt(act["eta_before"]),
                                                            idempotency_key=f"{state['workflow_id']}:eta-undo:{act['trip_id']}")
                        undone.append(f"ETA for {act['trip_id']}")
                    elif act["action"] == "book_request" and rules["compensation"].get("cancel_booking_on_failure", True):
                        await adapters.trip.cancel_booking(ctx, request_id=act["request_id"], idempotency_key=f"{state['workflow_id']}:unbook")
                        undone.append("standby booking")
                except Exception:
                    log.exception("no-show compensation step failed")
            raise

    needs = ["trip_mgmt.update_trip_eta"] + (["trip_mgmt.book_request", "trip_mgmt.cancel_booking"] if mode == "insert" else [])
    try:
        await _delegate(state, rules, "adjust_schedule", "trip", f"{mode}_adjustment", apply, requires=needs)
    except (ProductAPIError, PolicyViolation) as e:
        msg = str(e)
        await _audit(state, record_type="action_failed", step="adjust_schedule", outcome="failed", explanation=msg)
        await _audit(state, record_type="compensation", step="adjust_schedule", outcome="compensated", recommendation={"undone": undone},
                     explanation=f"Adjustment failed ({msg}). Undid {len(undone)} change(s) so trip management matches what riders were told.")
        await set_step(state["workflow_id"], "adjust_schedule", "failed", msg)
        return {"failure": {"step": "adjust_schedule", "message": msg, "at": now().isoformat()}, "compensation": [{"action": u} for u in undone]}
    run, plan, booked = out["run"], out["plan"], out["booked"]
    expl = (f"Booked {candidate['rider_name']} ({candidate['purpose']}) at {hm(candidate['proposed_pickup'])} on {run['vehicle_label']}. " if booked else "")
    expl += (f"Moved {plan['moved']} later pickup(s) by {plan['shift_min']:+d} min; late pickups {plan['late_before']} to {plan['late_after']}." if plan["moved"] else "No other pickup times changed.")
    await _audit(state, record_type="action_executed", step="adjust_schedule", autonomy_level=d.get("level"), outcome=f"{mode}_applied",
                 recommendation={"mode": mode, "booked_trip": booked, "changes": plan["changes"]},
                 human_action=d.get("decision") if d.get("decision") != "auto" else None, explanation=expl + _approved_by(d))
    await set_step(state["workflow_id"], "adjust_schedule", "done", ("Standby rider booked" if booked else f"{plan['moved']} pickup(s) moved earlier"))
    return {"adjustment": {"mode": mode, "booked": booked, "candidate": candidate, "changes": plan["changes"], "late_before": plan["late_before"],
                           "late_after": plan["late_after"], "shift_min": plan["shift_min"], "notify_threshold": th["notify_if_eta_change_min"]},
            "completed_actions": done}


MESSAGES = {
    "en": {"earlier": "TransitTech: good news, your {time} pickup at {stop} is now expected at {eta}, {mins} min sooner than we last told you.",
           "later": "TransitTech: your {time} pickup at {stop} is now expected at {eta} ({mins} min later). Your ride is confirmed.",
           "booked": "TransitTech: a seat opened up. Your ride from {stop} is booked for {time} on vehicle {vehicle}. Reply C to cancel."},
    "es": {"earlier": "TransitTech: buenas noticias, su recogida de las {time} en {stop} ahora se espera a las {eta}, {mins} min antes.",
           "later": "TransitTech: su recogida de las {time} en {stop} ahora se espera a las {eta} ({mins} min más tarde). Su viaje está confirmado.",
           "booked": "TransitTech: se liberó un asiento. Su viaje desde {stop} está reservado para las {time} en el vehículo {vehicle}. Responda C para cancelar."},
    "zh": {"earlier": "TransitTech：好消息，您在{stop}的{time}接载现预计于{eta}，比之前提早{mins}分钟。",
           "later": "TransitTech：您在{stop}的{time}接载现预计于{eta}（晚{mins}分钟）。您的行程已确认。",
           "booked": "TransitTech：有空位了。您从{stop}出发的行程已预订在{time}，车辆{vehicle}。回复C可取消。"},
}


async def exec_notify(state: NoShowState) -> dict:
    adj = state["adjustment"]
    rules = await _rules(state)
    names = await _rider_names([c["rider_id"] for c in adj["changes"]] + ([adj["booked"]["rider_id"]] if adj.get("booked") else []))
    sent = 0

    async def send_all(ctx) -> None:
        nonlocal sent
        if adj.get("booked"):
            b = adj["booked"]
            info = names.get(b["rider_id"], {"language": "en"})
            msg = MESSAGES.get(info["language"], MESSAGES["en"])["booked"].format(stop=b["pickup_stop"], time=f"{dt(b['pickup_time']):%H:%M}",
                                                                                   vehicle=state["assessment"]["run"]["vehicle_label"])
            await adapters.rider_comms.send_notification(ctx, rider_id=b["rider_id"], trip_id=b["trip_id"], kind="booking_confirmed", message=msg,
                                                         idempotency_key=f"{state['workflow_id']}:notify-book")
            sent += 1
        for c in adj["changes"]:
            if abs(c["change_min"]) < adj["notify_threshold"]:
                continue
            info = names.get(c["rider_id"], {"language": "en"})
            tpl = MESSAGES.get(info["language"], MESSAGES["en"])["earlier" if c["change_min"] < 0 else "later"]
            msg = tpl.format(time=f"{dt(c['pickup_time']):%H:%M}", stop=c["pickup_stop"], eta=f"{dt(c['eta_after']):%H:%M}", mins=abs(c["change_min"]))
            await adapters.rider_comms.send_notification(ctx, rider_id=c["rider_id"], trip_id=c["trip_id"], kind="eta_update", message=msg,
                                                         idempotency_key=f"{state['workflow_id']}:notify:{c['trip_id']}")
            sent += 1

    try:
        await _delegate(state, rules, "notify_riders", "rider_comms", "notify_riders", send_all, requires=["rider_comms.send"])
    except (ProductAPIError, PolicyViolation) as e:
        await _audit(state, record_type="action_failed", step="notify_riders", outcome="partial", explanation=f"{e}. {sent} sent before the failure.")
        await set_step(state["workflow_id"], "notify_riders", "failed", f"{sent} sent, then failed")
        return {"notifications": {"sent": sent}, "failure": {"step": "notify_riders", "message": str(e), "escalate_only": True, "at": now().isoformat()}}
    await _audit(state, record_type="action_executed", step="notify_riders", autonomy_level=_decision(state, "notify_riders").get("level"),
                 outcome="riders_notified", recommendation={"sent": sent}, actor="rider-comms-agent",
                 explanation=f"Sent {sent} rider message(s) in each rider's language and channel.")
    await set_step(state["workflow_id"], "notify_riders", "done", f"{sent} rider(s) notified")
    return {"notifications": {"sent": sent}}


async def close_node(state: NoShowState) -> dict:
    a = state["assessment"]
    adj = state.get("adjustment") or {}
    d = _decision(state, "adjust_schedule").get("decision")
    rec = {
        "kind": a["kind"], "mode": adj.get("mode") or ("rejected" if d == "rejected" else "hold"),
        "minutes_saved": a["minutes_saved"], "standby_booked": bool(adj.get("booked")),
        "standby_rider": (adj.get("candidate") or {}).get("rider_name") if adj.get("booked") else None,
        "pickups_moved": sum(1 for c in adj.get("changes", []) if c["change_min"] != 0),
        "late_before": adj.get("late_before", a["plan"]["late_before"]), "late_after": adj.get("late_after", a["plan"]["late_before"]),
        "riders_notified": (state.get("notifications") or {}).get("sent", 0),
        "flag_rider": a["flag_rider"], "rider_no_shows_30d": a["rider_no_shows_30d"], "rider_name": a["missed"]["rider_name"],
        "recovered": bool(adj) and not state.get("failure"),
    }
    parts = [f"{a['minutes_saved']} min freed on {a['run']['route_name']} {a['run']['block_name']}."]
    if rec["standby_booked"]:
        parts.append(f"Seat reused for standby rider {rec['standby_rider']}.")
    if rec["pickups_moved"]:
        parts.append(f"{rec['pickups_moved']} pickup(s) re-timed; late pickups {rec['late_before']} to {rec['late_after']}.")
    if d == "rejected":
        parts.append("Dispatcher kept the schedule unchanged.")
    if rec["flag_rider"]:
        parts.append(f"{rec['rider_name']} has {rec['rider_no_shows_30d']} no-shows in 30 days: flagged for no-show policy review.")
    await _audit(state, record_type="action_executed", step="close", autonomy_level="autonomous", outcome="recovery_logged",
                 recommendation=rec, explanation=" ".join(parts))
    await set_step(state["workflow_id"], "close", "done", "Recovery logged")
    await update_workflow(state["workflow_id"], context={"recovery": rec})
    return {"recovery": rec, "outcome": "completed"}


def _after_adjust_gate(state: NoShowState) -> str:
    return "exec_adjust" if _decision(state, "adjust_schedule").get("decision") in GO else "close"


def _after_adjust(state: NoShowState) -> str:
    if (state.get("failure") or {}).get("step") == "adjust_schedule" or not state.get("adjustment"):
        return "close"
    return "gate_notify_riders"


def _after_notify_gate(state: NoShowState) -> str:
    return "exec_notify" if _decision(state, "notify_riders").get("decision") in GO else "close"


def build_graph() -> StateGraph:
    g = StateGraph(NoShowState)
    g.add_node("assess", assess_node)
    g.add_node("gate_adjust_schedule", make_gate("adjust_schedule", _recommend, _options, _skip))
    g.add_node("exec_adjust", exec_adjust)
    g.add_node("gate_notify_riders", make_gate("notify_riders", _recommend, _options, _skip))
    g.add_node("exec_notify", exec_notify)
    g.add_node("close", close_node)
    g.add_edge(START, "assess")
    g.add_edge("assess", "gate_adjust_schedule")
    g.add_conditional_edges("gate_adjust_schedule", _after_adjust_gate, ["exec_adjust", "close"])
    g.add_conditional_edges("exec_adjust", _after_adjust, ["gate_notify_riders", "close"])
    g.add_conditional_edges("gate_notify_riders", _after_notify_gate, ["exec_notify", "close"])
    g.add_edge("exec_notify", "close")
    g.add_edge("close", END)
    return g


# ---------------------------------------------------------------- hooks used by OrchestratorService
TITLES = {"adjust_schedule": "Recover the freed slot on {route}", "notify_riders": "Notify riders on {route}"}


def title_for(step: str, values: dict) -> str:
    a = values["assessment"]
    return TITLES[step].format(route=f"{a['run']['route_name']} {a['run']['block_name']}")


def explain_context(step: str, values: dict, label: str) -> dict:
    a = values["assessment"]
    p = a["plan"]
    ctx = {"step": step, "vehicle_label": label, "workflow": WORKFLOW_TYPE, "mode": a["mode"], "minutes_saved": a["minutes_saved"],
           "route": f"{a['run']['route_name']} {a['run']['block_name']}", "moved": p["moved"], "late_before": p["late_before"],
           "late_after": p["late_after"], "candidate": p["candidate"], "reason": a["reason"]}
    if step == "notify_riders":
        adj = values.get("adjustment") or {}
        ctx.update(run_count=1, rider_count=sum(1 for c in adj.get("changes", []) if abs(c["change_min"]) >= adj.get("notify_threshold", 3)) + (1 if adj.get("booked") else 0))
    return ctx


def data_considered(values: dict, pending: dict) -> dict:
    a = values["assessment"]
    return {"kind": a["kind"], "minutes_saved": a["minutes_saved"], "run_delay_min": a["run"]["delay_minutes"],
            "seats_free": a["seats_free"], "wheelchair_free": a["wheelchair_free"], "standby_candidates": len(a["candidates"]),
            "downstream_pickups": a["downstream_count"], "rider_no_shows_30d": a["rider_no_shows_30d"], "policy_version": pending["policy_version"]}


def final_status(values: dict) -> str:
    d = (values.get("decisions") or {}).get("adjust_schedule", {}).get("decision")
    f = values.get("failure")
    if d == "shadow":
        return "shadow"
    if d == "rejected":
        return "rejected"
    if f and not f.get("escalate_only"):
        return "compensated"
    if f:
        return "completed_with_issues"
    if not values.get("adjustment"):
        return "informational"
    return "completed"
