"""Vehicle Health -> Service Continuity, as a LangGraph state machine.

The graph is the supervisor's control flow. Pattern for every write step: a *gate* node asks the
policy engine for the autonomy level and, when approval is needed, pauses the graph with
`interrupt()`. The graph state is checkpointed (PostgreSQL, or SQLite as a fallback), so a pause
can last days and survive restarts. An *exec* node then delegates the action to the domain agent
that owns the product (app/agents), acting with the permissions of the persona it serves, through
an adapter with an idempotency key, so re-running a node after a crash never duplicates anything.

Shadow level: the gate records exactly what the agent would do and moves on without acting, so
people keep working in the products and the Shadow mode screen compares the two.

Side effects that must happen exactly once per pause (approval cards, LLM
explanations) happen in OrchestratorService, outside the graph.
"""
from datetime import datetime, timedelta
from typing import Any

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from app.adapters.base import ActionContext
from app.adapters.registry import adapters
from app.agents import supervisor
from app.audit import service as audit
from app.core.clock import now
from app.core.database import session_scope
from app.core.errors import PolicyViolation, ProductAPIError
from app.core.logging import get_logger
from app.llm.router import llm
from app.orchestrator import assessment as A
from app.orchestrator.state import WorkflowState
from app.orchestrator.tracking import set_step, update_workflow
from app.policy.engine import policy_engine

log = get_logger("orchestrator.graph")
WORKFLOW_TYPE = "vehicle_health"
GO = ("approved", "overridden", "auto")
SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}


# ---------------------------------------------------------------- helpers
async def _rules(state: WorkflowState) -> dict:
    async with session_scope() as s:
        return await policy_engine.rules(s, state["tenant_id"], state.get("workflow_type") or WORKFLOW_TYPE)


async def _ctx(state: WorkflowState, rules: dict | None = None) -> ActionContext:
    rules = rules or await _rules(state)
    async with session_scope() as s:
        from app.models import Tenant

        tenant = await s.get(Tenant, state["tenant_id"])
    return ActionContext(tenant_id=state["tenant_id"], actor=tenant.agent_persona if tenant else "orchestrator-agent",
                         workflow_id=state["workflow_id"], trace_id=state["trace_id"],
                         allowed_actions=set(rules.get("agent_permissions", [])))


async def _delegate(state: WorkflowState, rules: dict, step: str, agent: str, task: str, fn, *, requires: list[str] | None = None,
                    decision: dict | None = None) -> Any:
    """Hand one product task to its domain agent, acting for the persona this step serves."""
    persona = supervisor.persona_for(rules, step, _decision(state, step) if decision is None else decision)
    return await supervisor.delegate(state, rules, step, agent, task, fn, persona=persona, requires=requires)


async def _read(state: WorkflowState, rules: dict, agent: str, task: str, fn, *, step: str = "assess") -> Any:
    """A read-only consult. The reads all happen while assessing, but each is recorded against the step it serves
    (e.g. the driver roster serves Reassign runs), so the step's agents show what they looked at."""
    return await _delegate(state, rules, step, agent, task, fn, decision={})


async def _roster(state: WorkflowState, rules: dict, on_date) -> list[dict]:
    """Driver roster from the workforce agent, each driver carrying Vestige compliance from the safety agent."""
    drivers = await _read(state, rules, "workforce", "driver_roster", lambda ctx: adapters.workforce.drivers(ctx), step="reassign_runs")
    ids = [d["driver_id"] for d in drivers if d.get("driver_id")]
    comp = await _read(state, rules, "safety", "driver_compliance", lambda ctx: adapters.safety.driver_compliance(ctx, ids, on_date),
                       step="reassign_runs")
    return [{**d, "compliance": comp.get(d.get("driver_id"))} for d in drivers]


async def _spare_defects(state: WorkflowState, rules: dict) -> dict[str, list]:
    """Safety agent: open Vestige defects on the vehicles that could stand in, so no spare with a defect is proposed."""
    fleet = await _read(state, rules, "trip", "spare_fleet", lambda ctx: adapters.trip.fleet(ctx), step="reassign_runs")
    ids = [v["vehicle_id"] for v in fleet if v["vehicle_id"] != state["vehicle_id"] and v["status"] != "out_of_service"]

    async def check(ctx):
        found = {}
        for v in ids:
            if d := await adapters.safety.open_defects(ctx, v):
                found[v] = d
        return found
    return await _read(state, rules, "safety", "spare_vehicle_health", check, step="reassign_runs")


def _needs_defect(rules: dict, fault: dict) -> bool:
    cfg = rules.get("safety") or {}
    if fault.get("system") in (cfg.get("defect_systems") or []):
        return True
    floor = SEVERITY_RANK.get(cfg.get("defect_min_severity") or "critical", 3)
    return SEVERITY_RANK.get(fault.get("severity"), 0) >= floor


async def _audit(state: WorkflowState, **kw: Any) -> None:
    async with session_scope() as s:
        await audit.record(s, tenant_id=state["tenant_id"], workflow_id=state["workflow_id"], trace_id=state["trace_id"],
                           triggering_event_id=state["trigger_event_id"], **kw)


def _decision(state: WorkflowState, step: str) -> dict:
    return (state.get("decisions") or {}).get(step, {})


def _with_decision(state: WorkflowState, step: str, d: dict) -> dict:
    return {"decisions": {**(state.get("decisions") or {}), step: d}}


def _approved_by(d: dict) -> str:
    if d.get("decision") in ("approved", "overridden") and d.get("actor"):
        return f" {'Approved with changes' if d['decision'] == 'overridden' else 'Approved'} by {d['actor']}."
    return ""


def _failure_update(state: WorkflowState, step: str, exc: Exception) -> dict:
    msg = exc.message if isinstance(exc, ProductAPIError) else str(exc)
    return {"failure": {"step": step, "message": msg, "system": getattr(exc, "system", None), "at": now().isoformat()}}


# ---------------------------------------------------------------- assess
async def assess_node(state: WorkflowState) -> dict:
    await set_step(state["workflow_id"], "detect", "done", f"Received {state['trigger_type']}", "autonomous")
    await set_step(state["workflow_id"], "assess", "active", "Evaluating severity, runs at risk and spares", "autonomous")
    rules = await _rules(state)
    vid = state["vehicle_id"]

    async def asset_view(ctx):
        return (await A.classify_trigger(ctx, state["trigger_type"], state["trigger"], rules), await adapters.asset.vehicle_health(ctx, vid))

    # Detect: the asset agent identifies the fault and the vehicle's health.
    fault, health = await _read(state, rules, "asset", "classify_fault_and_health", asset_view, step="detect")
    # Pull vehicle: the trip agent works out when the vehicle comes off the road and which runs lose it.
    vehicle = await _read(state, rules, "trip", "read_vehicle", lambda ctx: adapters.trip.vehicle(ctx, vid), step="pull_vehicle")
    earliest, immediate, timing_reason = await _read(state, rules, "trip", "current_run",
                                                     lambda ctx: A.earliest_shop_start(ctx, vid, fault["severity"]), step="pull_vehicle")
    # Assess: the asset agent finds the shop window.
    window = await _read(state, rules, "asset", "find_shop_window",
                         lambda ctx: adapters.asset.find_shop_window(ctx, vid, earliest, int(fault["est_repair_hours"]), immediate))
    oos_from, oos_until = A.out_of_service(earliest, immediate, window)
    oos_until = await _read(state, rules, "trip", "next_block", lambda ctx: A.through_next_block(ctx, rules, vid, oos_from, oos_until),
                            step="pull_vehicle")
    at_risk, later = await _read(state, rules, "trip", "runs_at_risk", lambda ctx: A.runs_in_window(ctx, rules, vid, oos_from, oos_until),
                                 step="pull_vehicle")
    # Reassign runs: workforce finds drivers, safety checks their compliance and the spare vehicles' defects, trip plans the cover.
    roster = await _roster(state, rules, oos_from.date()) if at_risk else []
    unsafe = await _spare_defects(state, rules) if at_risk else {}
    defects = await _read(state, rules, "safety", "open_defects", lambda ctx: adapters.safety.open_defects(ctx, vid), step="open_work_order")
    proposals = await _read(state, rules, "trip", "plan_cover", lambda ctx: A.plan_cover(ctx, rules, vid, at_risk, roster, unsafe),
                            step="reassign_runs")
    noncompliant = [{"driver_id": d["driver_id"], "name": d["name"], "reasons": d["compliance"]["blocking"]}
                    for d in roster if d.get("compliance") and d["compliance"].get("blocking")]
    a = {
        "severity": fault["severity"], "fault": fault, "vehicle": vehicle, "health": health,
        "timing_reason": timing_reason, "oos_from": oos_from.isoformat(), "oos_until": oos_until.isoformat(),
        "shop_from": window["start"], "shop_until": window["end"], "pull_now": immediate, "depot": window["depot"],
        "runs_at_risk": at_risk, "later_runs": later, "proposals": proposals,
        "safety": {"open_defects": defects, "noncompliant_drivers": noncompliant, "will_log_defect": _needs_defect(rules, fault)},
    }
    llm_ctx = {
        "vehicle_label": state["vehicle_label"], "severity": a["severity"], "fault_description": a["fault"]["description"],
        "trigger_code": a["fault"]["code"], "depot": a["depot"], "timing": a["timing_reason"],
        "out_of_service_from_h": A.hm(a["oos_from"]), "out_of_service_until_h": A.hm(a["oos_until"]),
        "runs_at_risk": [{k: r[k] for k in ("run_id", "route_name", "start", "riders", "needs_wheelchair")} for r in a["runs_at_risk"]],
        "proposals": [{k: p[k] for k in ("run_id", "vehicle_id", "vehicle_label", "driver_id", "driver_name", "candidates", "driver_candidates")} for p in a["proposals"]],
        "drivers_excluded_by_safety": [f"{d['name']}: {'; '.join(d['reasons'])}" for d in noncompliant][:5],
    }
    res = await llm.run("assess", llm_ctx, tenant_id=state["tenant_id"], workflow_id=state["workflow_id"])
    data = res.data or {}
    # The model may only swap to candidates that already passed hard constraints.
    applied_overrides = []
    for o in data.get("assignment_overrides") or []:
        for p in a["proposals"]:
            if p["run_id"] != o.get("run_id"):
                continue
            v_ok = any(c["vehicle_id"] == o.get("vehicle_id") for c in p["candidates"])
            d_ok = any(c["driver_id"] == o.get("driver_id") and c.get("eligible", True) for c in p["driver_candidates"])
            if v_ok and d_ok:
                cand = next(c for c in p["candidates"] if c["vehicle_id"] == o["vehicle_id"])
                drv = next(c for c in p["driver_candidates"] if c["driver_id"] == o["driver_id"])
                p.update(vehicle_id=cand["vehicle_id"], vehicle_label=cand["label"], vehicle_type=cand["vehicle_type"],
                         driver_id=drv["driver_id"], driver_name=drv["name"], reason=f"{cand['label']} (model preference)")
                applied_overrides.append(o)
    a["summary"] = data.get("summary") or res.text
    a["rationale"] = data.get("rationale", "")
    a["confidence"] = data.get("confidence")
    a["model"] = res.model
    covered = sum(1 for p in a["proposals"] if p["vehicle_id"] and p["driver_id"])
    await _audit(
        state, record_type="assessment", step="assess", autonomy_level="autonomous", model_used=res.model,
        data_considered={"trigger": state["trigger"], "fault": a["fault"], "vehicle": a["vehicle"], "health": a["health"],
                         "runs_at_risk": a["runs_at_risk"], "later_runs": a["later_runs"],
                         "candidates": {p["run_id"]: p["candidates"] for p in a["proposals"]}, "safety": a["safety"],
                         "agents_consulted": ["asset", "trip", "workforce", "safety"]},
        recommendation={"severity": a["severity"], "out_of_service_from": a["oos_from"], "out_of_service_until": a["oos_until"],
                        "depot": a["depot"], "proposals": [{k: p[k] for k in ("run_id", "vehicle_label", "driver_name")} for p in a["proposals"]],
                        "model_overrides_applied": applied_overrides},
        outcome="assessed", explanation=a["summary"], input_tokens=res.input_tokens, output_tokens=res.output_tokens,
    )
    title = f"{state['vehicle_label']}: {a['fault']['description']}"
    await set_step(state["workflow_id"], "assess", "done", f"Severity {a['severity']}, {len(a['runs_at_risk'])} run(s) at risk", "autonomous",
                   severity=a["severity"], title=title, summary=a["summary"], runs_at_risk=len(a["runs_at_risk"]), runs_covered=covered,
                   context={"assessment": a, "agent_plan": supervisor.plan(WORKFLOW_TYPE)})
    return {"assessment": a}


def _uncovered(a: dict, covered: set[str]) -> list[dict]:
    """Runs at risk that have no cover, each with the reason the agent could not cover it."""
    out = []
    for p in a["proposals"]:
        if p["run_id"] in covered:
            continue
        if not p["vehicle_id"]:
            why = (f"no spare vehicle is free for the whole run with {p['riders']} seat(s)"
                   + (" and a wheelchair position" if p["needs_wheelchair"] else ""))
        elif not p["driver_id"]:
            why = f"spare {p['vehicle_label']} is free, but no qualified, compliant driver with hours left is available"
        else:
            why = "left for the dispatcher when the cover plan was approved"
        out.append({**{k: p.get(k) for k in ("run_id", "route_name", "block_name", "start", "start_h", "riders", "needs_wheelchair", "vehicle_label")},
                    "reason": why, "spares_checked": len(p.get("candidates") or [])})
    return out


def _coverage_gap(state: WorkflowState, runs: list[dict]) -> dict:
    riders = sum(r["riders"] for r in runs)
    detail = "; ".join(f"{r['route_name']} {r['block_name']} at {r['start_h']} ({r['riders']} riders): {r['reason']}" for r in runs)
    text = (f"{state['vehicle_label']} is coming off the road and the agent could not cover {len(runs)} of its run(s), "
            f"{riders} booked rider(s) in all. {detail}. Please arrange cover by hand: call in an off-duty driver, borrow a vehicle "
            "from the other depot, or rebook the riders.")
    return {"runs": runs, "riders": riders, "text": text, "at": now().isoformat()}


# ---------------------------------------------------------------- gates
def make_gate(step: str, recommend=None, options=None, skip=None):
    """Policy gate shared by all workflows. recommend/options/skip default to the vehicle health versions."""
    recommend = recommend or _recommendation
    options = options or _options
    skip = skip or _skip_reason

    async def gate(state):  # untyped on purpose: LangGraph filters input keys by a node's type annotation
        rules = await _rules(state)
        a = state["assessment"]
        level = policy_engine.level_for(rules, step, a.get("severity"))
        skip_reason = skip(state, step)
        if skip_reason:
            await set_step(state["workflow_id"], step, "skipped", skip_reason, level)
            return _with_decision(state, step, {"decision": "skipped", "level": level, "reason": skip_reason})
        if level == "autonomous":
            await set_step(state["workflow_id"], step, "active", "Agent acting under policy", level)
            await _audit(state, record_type="decision", step=step, autonomy_level=level, recommendation=recommend(state, step),
                         outcome="auto_approved", explanation=f"Policy v{rules['_version']} allows the agent to {step.replace('_', ' ')} without approval.")
            return _with_decision(state, step, {"decision": "auto", "level": level, "actor": "orchestrator-agent"})
        if level == "shadow":
            rec = recommend(state, step)
            from app.orchestrator import shadow

            await shadow.record(state, step, rec, rules)
            await _audit(state, record_type="shadow_recommendation", step=step, autonomy_level=level, recommendation=rec, outcome="shadow_recorded",
                         explanation=f"Shadow mode (policy v{rules['_version']}): the agent would {step.replace('_', ' ')} as recommended. "
                                     "No action taken; people act in the products as usual and the result is compared.")
            await set_step(state["workflow_id"], step, "shadowed", "Shadow: recommended, not executed", level)
            return _with_decision(state, step, {"decision": "shadow", "level": level})
        if level == "informational":
            await _audit(state, record_type="decision", step=step, autonomy_level=level, recommendation=recommend(state, step),
                         outcome="recommended_only", explanation=f"Policy v{rules['_version']} makes {step.replace('_', ' ')} informational: recommend, do not act.")
            await set_step(state["workflow_id"], step, "recommended", "Recommendation shared; no action taken (informational policy)", level)
            return _with_decision(state, step, {"decision": "informational", "level": level})
        # semi-autonomous: pause until a person decides (resume value comes from OrchestratorService)
        await set_step(state["workflow_id"], step, "awaiting_approval", "Waiting for approval", level)
        decision = interrupt({
            "type": "approval", "step": step, "level": level, "approver_roles": policy_engine.approver_roles(rules, step),
            "recommendation": recommend(state, step), "options": options(state, step), "policy_version": rules["_version"],
        })
        return _with_decision(state, step, {**decision, "level": level})

    gate.__name__ = f"gate_{step}"
    return gate


def make_reassign_gate():
    """Reassign runs, but when no run can be covered the agent raises it with the dispatcher instead of skipping the step."""
    base = make_gate("reassign_runs")

    async def gate(state):
        a = state["assessment"]
        rules = await _rules(state)
        level = policy_engine.level_for(rules, "reassign_runs", a.get("severity"))
        if a["runs_at_risk"] and level != "shadow" and not any(p["vehicle_id"] and p["driver_id"] for p in a["proposals"]):
            gap = _coverage_gap(state, _uncovered(a, set()))
            await _audit(state, record_type="decision", step="reassign_runs", autonomy_level=level, outcome="escalated",
                         data_considered={"uncovered_runs": gap["runs"]}, recommendation={"action": "dispatcher to arrange cover"},
                         explanation=gap["text"])
            await set_step(state["workflow_id"], "reassign_runs", "escalated",
                           f"No spare vehicle and driver for {len(gap['runs'])} run(s); raised with the dispatcher", level)
            return {**_with_decision(state, "reassign_runs", {"decision": "escalated", "level": level}), "coverage_gap": gap}
        return await base(state)

    gate.__name__ = "gate_reassign_runs"
    return gate


def _skip_reason(state: WorkflowState, step: str) -> str:
    a = state["assessment"]
    if step in ("reassign_runs", "notify_riders") and not a["runs_at_risk"]:
        return "No scheduled runs are affected"
    if step == "reassign_runs" and not any(p["vehicle_id"] and p["driver_id"] for p in a["proposals"]):
        return "No qualified spare vehicle and driver found; runs flagged for the dispatcher"
    if step == "notify_riders" and not state.get("assignments") and _decision(state, "reassign_runs").get("decision") != "shadow":
        return "No runs were reassigned"
    if step == "pull_vehicle" and not state.get("work_order") and _decision(state, "open_work_order").get("decision") != "shadow":
        return "No work order"
    if step == "return_to_service" and not state.get("work_order") and not state.get("block"):
        return "Vehicle was not taken out of service"
    return ""


def _recommendation(state: WorkflowState, step: str) -> dict:
    a = state["assessment"]
    if step == "open_work_order":
        return {"priority": A.priority_for(a["severity"]), "title": a["fault"]["description"], "fault_code": a["fault"]["code"],
                "shop_start": a.get("shop_from", a["oos_from"]), "shop_end": a.get("shop_until", a["oos_until"]), "depot": a["depot"],
                "timing": a["timing_reason"]}
    if step == "pull_vehicle":
        return {"vehicle_label": state["vehicle_label"], "from": a["oos_from"], "until": a["oos_until"],
                "runs_affected": [{k: r[k] for k in ("run_id", "route_name", "block_name", "start", "riders")} for r in a["runs_at_risk"]],
                "later_runs": len(a["later_runs"])}
    if step == "reassign_runs":
        return {"assignments": [{k: p.get(k) for k in ("run_id", "route_name", "block_name", "start", "start_h", "riders", "needs_wheelchair",
                                                       "vehicle_id", "vehicle_label", "driver_id", "driver_name", "keep_driver", "delay_minutes", "reason")}
                                for p in a["proposals"]]}
    if step == "notify_riders":
        runs = state.get("assignments") or ([p for p in a["proposals"] if p["vehicle_id"]] if _decision(state, "reassign_runs").get("decision") == "shadow" else [])
        return {"runs": [x["run_id"] for x in runs], "riders": sum(x.get("riders", 0) for x in runs)}
    if step == "return_to_service":
        return {"vehicle_label": state["vehicle_label"], "work_order_id": (state.get("work_order") or {}).get("work_order_id")}
    return {}


def _options(state: WorkflowState, step: str) -> dict:
    a = state["assessment"]
    if step == "reassign_runs":
        return {"per_run": {p["run_id"]: {"vehicles": p["candidates"], "drivers": [d for d in p["driver_candidates"] if d.get("eligible", True)]}
                            for p in a["proposals"]}}
    if step in ("open_work_order", "pull_vehicle"):
        return {"editable": ["shop_start", "shop_end", "priority"] if step == "open_work_order" else ["from", "until"]}
    return {}


def route_after_gate(step: str, exec_node: str, on_stop, on_shadow: str | None = None):
    def route(state: WorkflowState) -> str:
        d = _decision(state, step).get("decision")
        if d in GO:
            return exec_node
        if d == "shadow" and on_shadow:
            return on_shadow
        return on_stop(state) if callable(on_stop) else on_stop
    return route


# ---------------------------------------------------------------- executors
async def exec_open_work_order(state: WorkflowState) -> dict:
    a, d = state["assessment"], _decision(state, "open_work_order")
    rules = await _rules(state)
    ov = d.get("override") or {}
    start = A.dt(ov.get("shop_start") or a.get("shop_from", a["oos_from"]))
    end = A.dt(ov.get("shop_end") or a.get("shop_until", a["oos_until"]))
    priority = ov.get("priority") or A.priority_for(a["severity"])
    try:
        wo = await _delegate(state, rules, "open_work_order", "asset", "create_work_order", lambda ctx: adapters.asset.create_work_order(
            ctx, vehicle_id=state["vehicle_id"], priority=priority, title=f"{a['fault']['description']} ({a['fault']['code']})",
            description=f"Opened by orchestrator from {state['trigger_type']}. {a['summary']}", fault_code=a["fault"]["code"],
            shop_start=start, shop_end=end, idempotency_key=f"{state['workflow_id']}:open_work_order",
        ), requires=["asset_mgmt.create_work_order"])
    except (ProductAPIError, PolicyViolation) as e:
        await _audit(state, record_type="action_failed", step="open_work_order", outcome="failed", explanation=str(e))
        await set_step(state["workflow_id"], "open_work_order", "failed", str(e))
        return _failure_update(state, "open_work_order", e)
    await _audit(state, record_type="action_executed", step="open_work_order", autonomy_level=d.get("level"),
                 recommendation={"priority": priority, "shop_start": start.isoformat(), "shop_end": end.isoformat()}, outcome="work_order_created",
                 explanation=f"Created {wo['work_order_id']} ({priority}) in FASTER, shop {start:%a %H:%M} to {end:%a %H:%M}." + _approved_by(d),
                 human_action=d.get("decision") if d.get("decision") != "auto" else None, actor="asset-agent")
    actions = state.get("completed_actions", []) + [{"step": "open_work_order", "action": "create_work_order", "work_order_id": wo["work_order_id"]}]
    detail = f"{wo['work_order_id']} created"
    upd: dict = {"work_order": wo}
    # Safety side of the fault: record the defect in Vestige. A failure here never blocks the repair.
    if _needs_defect(rules, a["fault"]):
        try:
            defect = await _delegate(state, rules, "open_work_order", "safety", "open_defect", lambda ctx: adapters.safety.open_defect(
                ctx, vehicle_id=state["vehicle_id"], category=a["fault"].get("system") or "Mechanical", severity=a["severity"],
                description=f"{a['fault']['description']} ({a['fault']['code']}). Work order {wo['work_order_id']}.",
                work_order_id=wo["work_order_id"], idempotency_key=f"{state['workflow_id']}:open_defect",
            ), requires=["safety.open_defect"])
            upd["defect"] = defect
            actions.append({"step": "open_work_order", "action": "open_defect", "defect_id": defect["defect_id"]})
            detail += f", defect {defect['defect_id']} logged in Vestige"
            await _audit(state, record_type="action_executed", step="open_work_order", autonomy_level=d.get("level"), outcome="defect_recorded",
                         recommendation={"defect_id": defect["defect_id"], "category": a["fault"].get("system")}, actor="safety-agent",
                         explanation=f"Recorded vehicle defect {defect['defect_id']} in Vestige for {state['vehicle_label']}"
                                     f" ({a['fault'].get('system')}, {a['severity']}), linked to {wo['work_order_id']}.")
        except (ProductAPIError, PolicyViolation) as e:
            await _audit(state, record_type="action_failed", step="open_work_order", outcome="partial", actor="safety-agent",
                         explanation=f"Work order created, but the Vestige defect record failed: {e}. Safety team alerted.")
            detail += "; Vestige defect not recorded"
            upd["safety_alert"] = str(e)
    await set_step(state["workflow_id"], "open_work_order", "done", detail, work_order_opened_at=now())
    upd["completed_actions"] = actions
    # A changed shop window changes the out-of-service window too.
    if ov.get("shop_start") or ov.get("shop_end"):
        pull_from = min(A.dt(a["oos_from"]), start) if a.get("pull_now") else start  # an urgent fault still comes off the road now
        upd["assessment"] = await _replan(state, pull_from, end, shop=(start, end))
    return upd


async def _replan(state: WorkflowState, start: datetime, end: datetime, shop: tuple[datetime, datetime] | None = None) -> dict:
    rules = await _rules(state)
    a = dict(state["assessment"])
    vid = state["vehicle_id"]
    end = await _read(state, rules, "trip", "next_block", lambda ctx: A.through_next_block(ctx, rules, vid, start, end), step="pull_vehicle")
    at_risk, later = await _read(state, rules, "trip", "runs_at_risk", lambda ctx: A.runs_in_window(ctx, rules, vid, start, end),
                                 step="pull_vehicle")
    roster = await _roster(state, rules, start.date()) if at_risk else []
    unsafe = await _spare_defects(state, rules) if at_risk else {}
    proposals = await _read(state, rules, "trip", "plan_cover", lambda ctx: A.plan_cover(ctx, rules, vid, at_risk, roster, unsafe),
                            step="reassign_runs")
    a.update(oos_from=start.isoformat(), oos_until=end.isoformat(), runs_at_risk=at_risk, later_runs=later, proposals=proposals)
    if shop:
        a.update(shop_from=shop[0].isoformat(), shop_until=shop[1].isoformat())
    await update_workflow(state["workflow_id"], runs_at_risk=len(at_risk), context={"assessment": a})
    await _audit(state, record_type="assessment", step="assess", outcome="replanned",
                 data_considered={"runs_at_risk": at_risk}, recommendation={"from": a["oos_from"], "until": a["oos_until"]},
                 explanation=f"Window changed by a person to {start:%a %H:%M} - {end:%a %H:%M}; runs at risk recalculated ({len(at_risk)}).")
    return a


async def exec_pull_vehicle(state: WorkflowState) -> dict:
    a, d = state["assessment"], _decision(state, "pull_vehicle")
    rules = await _rules(state)
    ov = d.get("override") or {}
    start = A.dt(ov.get("from") or a["oos_from"])
    end = A.dt(ov.get("until") or a["oos_until"])
    upd: dict = {}
    if ov.get("from") or ov.get("until"):
        upd["assessment"] = a = await _replan(state, start, end)
    try:
        blk = await _delegate(state, rules, "pull_vehicle", "trip", "block_vehicle", lambda ctx: adapters.trip.block_vehicle(
            ctx, vehicle_id=state["vehicle_id"], start=start, end=end,
            reason=f"Shop: {(state.get('work_order') or {}).get('work_order_id', '')} {a['fault']['description']}",
            ref=state["workflow_id"], idempotency_key=f"{state['workflow_id']}:pull_vehicle",
        ), requires=["trip_mgmt.block_vehicle"])
    except (ProductAPIError, PolicyViolation) as e:
        await _audit(state, record_type="action_failed", step="pull_vehicle", outcome="failed", explanation=str(e))
        await set_step(state["workflow_id"], "pull_vehicle", "failed", str(e))
        return {**upd, **_failure_update(state, "pull_vehicle", e)}
    await _audit(state, record_type="action_executed", step="pull_vehicle", autonomy_level=d.get("level"), outcome="vehicle_blocked",
                 recommendation={"from": start.isoformat(), "until": end.isoformat()}, actor="trip-agent",
                 explanation=f"{state['vehicle_label']} marked unavailable {start:%a %d %b %H:%M} to {end:%a %d %b %H:%M} in trip management." + _approved_by(d),
                 human_action=d.get("decision") if d.get("decision") != "auto" else None)
    await set_step(state["workflow_id"], "pull_vehicle", "done", f"Unavailable {start:%a %H:%M} - {end:%a %H:%M}", pulled_at=now())
    return {**upd, "block": blk, "completed_actions": state.get("completed_actions", []) + [{"step": "pull_vehicle", "action": "block_vehicle", "ref": state["workflow_id"]}]}


async def exec_reassign_runs(state: WorkflowState) -> dict:
    a, d = state["assessment"], _decision(state, "reassign_runs")
    rules = await _rules(state)
    chosen = {p["run_id"]: p for p in a["proposals"] if p["vehicle_id"] and p["driver_id"]}
    for o in (d.get("override") or {}).get("assignments", []):
        base = next((p for p in a["proposals"] if p["run_id"] == o["run_id"]), None)
        if base is None:
            continue
        if not o.get("vehicle_id"):
            chosen.pop(o["run_id"], None)  # person chose to leave this run for manual handling
            continue
        veh = next((c for c in base["candidates"] if c["vehicle_id"] == o["vehicle_id"]), None)
        drv = next((c for c in base["driver_candidates"] if c["driver_id"] == o.get("driver_id")), None)
        chosen[o["run_id"]] = {**base, "vehicle_id": o["vehicle_id"], "vehicle_label": veh["label"] if veh else o.get("vehicle_label"),
                               "driver_id": o.get("driver_id") or base["driver_id"], "driver_name": drv["name"] if drv else base["driver_name"]}
    applied: list[dict] = []

    async def reassign(ctx: ActionContext) -> None:
        try:
            for run_id, p in chosen.items():
                await adapters.trip.assign_run(ctx, run_id=run_id, vehicle_id=p["vehicle_id"], driver_id=p["driver_id"], ref=state["workflow_id"],
                                               idempotency_key=f"{state['workflow_id']}:assign:{run_id}:{p['vehicle_id']}:{p['driver_id']}")
                applied.append({k: p.get(k) for k in ("run_id", "route_name", "block_name", "start", "vehicle_id", "vehicle_label", "driver_id", "driver_name", "delay_minutes", "riders")})
        except (ProductAPIError, PolicyViolation):
            # Undo the runs already moved in this step before handing over to compensation.
            for x in reversed(applied):
                try:
                    await adapters.trip.revert_run(ctx, run_id=x["run_id"], idempotency_key=f"{state['workflow_id']}:revert:{x['run_id']}:partial")
                except Exception:
                    log.exception("partial revert failed for %s", x["run_id"])
            raise

    try:
        await _delegate(state, rules, "reassign_runs", "trip", "reassign_runs", reassign, requires=["trip_mgmt.assign_run", "trip_mgmt.revert_run"])
    except (ProductAPIError, PolicyViolation) as e:
        await _audit(state, record_type="action_failed", step="reassign_runs", outcome="failed",
                     explanation=f"{e}. Reverted {len(applied)} run(s) already reassigned in this step.")
        await set_step(state["workflow_id"], "reassign_runs", "failed", str(e))
        return _failure_update(state, "reassign_runs", e)
    uncovered = len(a["runs_at_risk"]) - len(applied)
    await _audit(state, record_type="action_executed", step="reassign_runs", autonomy_level=d.get("level"), outcome="runs_reassigned",
                 recommendation={"assignments": applied}, actor="trip-agent",
                 human_action=d.get("decision") if d.get("decision") != "auto" else None,
                 explanation=f"Reassigned {len(applied)} run(s)" + (f"; {uncovered} left for the dispatcher" if uncovered else "") + "." + _approved_by(d))
    gap = _coverage_gap(state, _uncovered(a, {x["run_id"] for x in applied})) if uncovered else None
    await set_step(state["workflow_id"], "reassign_runs", "done",
                   f"{len(applied)} of {len(a['runs_at_risk'])} run(s) covered" + (f"; {uncovered} raised with the dispatcher" if uncovered else ""),
                   runs_covered=len(applied))
    return {"assignments": applied, "coverage_gap": gap,
            "completed_actions": state.get("completed_actions", []) + [{"step": "reassign_runs", "action": "assign_run", "run_id": x["run_id"]} for x in applied]}


async def exec_notify_riders(state: WorkflowState) -> dict:
    rules = await _rules(state)
    by_run = {x["run_id"]: x for x in state.get("assignments", [])}
    window_min = rules["thresholds"]["delay_applies_within_minutes_of_run_start"]
    from app.core.database import SessionLocal
    from app.models import Rider

    trips = await _delegate(state, rules, "notify_riders", "trip", "read_trips", lambda ctx: adapters.trip.trips_for_runs(ctx, list(by_run)))
    plan = []
    for t in trips:
        run = by_run[t["run_id"]]
        pickup, eta = A.dt(t["pickup_time"]), A.dt(t["eta"])
        is_delayed = run["delay_minutes"] > 0 and pickup <= A.dt(run["start"]) + timedelta(minutes=window_min)
        plan.append((t, run, pickup, eta + timedelta(minutes=run["delay_minutes"]) if is_delayed else eta, is_delayed))
    sent, delayed = 0, 0

    async def update_etas(ctx: ActionContext) -> None:
        nonlocal delayed
        for t, run, pickup, new_eta, is_delayed in plan:
            if is_delayed:
                await adapters.trip.update_trip_eta(ctx, trip_id=t["trip_id"], eta=new_eta, idempotency_key=f"{state['workflow_id']}:eta:{t['trip_id']}")
                delayed += 1

    async def send_messages(ctx: ActionContext) -> None:
        nonlocal sent
        for t, run, pickup, new_eta, is_delayed in plan:
            async with SessionLocal() as s:
                rider = await s.get(Rider, t["rider_id"])
            msg = A.rider_message(rider.language if rider else "en", is_delayed, time=f"{pickup:%H:%M}", stop=t["pickup_stop"],
                                  eta=f"{new_eta:%H:%M}", mins=run["delay_minutes"], vehicle=run["vehicle_label"])
            await adapters.rider_comms.send_notification(ctx, rider_id=t["rider_id"], trip_id=t["trip_id"],
                                                         kind="eta_update" if is_delayed else "vehicle_change", message=msg,
                                                         idempotency_key=f"{state['workflow_id']}:notify:{t['trip_id']}")
            sent += 1

    try:
        if any(x[4] for x in plan):
            await _delegate(state, rules, "notify_riders", "trip", "update_etas", update_etas, requires=["trip_mgmt.update_trip_eta"])
        await _delegate(state, rules, "notify_riders", "rider_comms", "notify_riders", send_messages, requires=["rider_comms.send"])
    except (ProductAPIError, PolicyViolation) as e:
        failed = len(plan) - sent
        await _audit(state, record_type="action_failed", step="notify_riders", outcome="partial",
                     explanation=f"{e}. {sent} sent, {failed} not sent; dispatcher alerted.")
        await set_step(state["workflow_id"], "notify_riders", "failed", f"{sent} sent, {failed} failed")
        # Notification failure does not undo the schedule: riders still have a ride. Escalate instead.
        return {"notifications": {"sent": sent, "delayed": delayed, "failed": failed},
                "failure": {"step": "notify_riders", "message": str(e), "escalate_only": True, "at": now().isoformat()}}
    await _audit(state, record_type="action_executed", step="notify_riders", autonomy_level=_decision(state, "notify_riders").get("level"),
                 outcome="riders_notified", recommendation={"sent": sent, "delayed": delayed}, actor="rider-comms-agent",
                 explanation=f"Sent {sent} rider notification(s), {delayed} with a later ETA, in each rider's language and channel.")
    await set_step(state["workflow_id"], "notify_riders", "done", f"{sent} rider(s) notified, {delayed} with new ETA")
    return {"notifications": {"sent": sent, "delayed": delayed, "failed": 0}}


async def await_work_order_close(state: WorkflowState) -> dict:
    wo = state.get("work_order")
    if not wo:
        return {}
    await set_step(state["workflow_id"], "return_to_service", "waiting", f"Waiting for {wo['work_order_id']} to close in the shop")
    rules = await _rules(state)
    current = await _delegate(state, rules, "return_to_service", "asset", "check_work_order",
                              lambda ctx: adapters.asset.get_work_order(ctx, wo["work_order_id"]), decision={})
    if current["status"] in ("closed", "cancelled"):
        return {"returned": {"work_order_status": current["status"], "closed_by": current.get("closed_by"), "resolution": current.get("resolution")}}
    event = interrupt({"type": "await_event", "event": "workorder.closed", "work_order_id": wo["work_order_id"]})
    return {"returned": event}


async def exec_return_to_service(state: WorkflowState) -> dict:
    d = _decision(state, "return_to_service")
    rules = await _rules(state)
    restored = False
    ret = state.get("returned") or {}
    if state.get("block"):
        try:
            res = await _delegate(state, rules, "return_to_service", "trip", "return_vehicle", lambda ctx: adapters.trip.unblock_vehicle(
                ctx, ref=state["workflow_id"], reason="Work order closed", idempotency_key=f"{state['workflow_id']}:return_to_service"),
                requires=["trip_mgmt.unblock_vehicle"])
            restored = res.get("restored", False)
        except (ProductAPIError, PolicyViolation) as e:
            await _audit(state, record_type="action_failed", step="return_to_service", outcome="failed", explanation=str(e))
            await set_step(state["workflow_id"], "return_to_service", "failed", str(e))
            return {"failure": {"step": "return_to_service", "message": str(e), "escalate_only": True, "at": now().isoformat()}}
    defect_note = ""
    if state.get("defect") and ret.get("work_order_status", "closed") == "closed":
        try:
            await _delegate(state, rules, "return_to_service", "safety", "clear_defect", lambda ctx: adapters.safety.close_defect(
                ctx, defect_id=state["defect"]["defect_id"], resolution=f"Repaired under {(state.get('work_order') or {}).get('work_order_id')}: "
                                                                        f"{ret.get('resolution') or 'work order closed'}",
                idempotency_key=f"{state['workflow_id']}:close_defect"), requires=["safety.close_defect"])
            defect_note = f" Vestige defect {state['defect']['defect_id']} cleared."
        except (ProductAPIError, PolicyViolation) as e:
            await _audit(state, record_type="action_failed", step="return_to_service", outcome="partial", actor="safety-agent",
                         explanation=f"Vehicle returned, but clearing Vestige defect {state['defect']['defect_id']} failed: {e}.")
            defect_note = f" Vestige defect {state['defect']['defect_id']} still open: {e}."
    await _audit(state, record_type="action_executed", step="return_to_service", autonomy_level=d.get("level"), outcome="returned_to_service",
                 recommendation={"restored": restored}, actor="trip-agent",
                 explanation=f"{(state.get('work_order') or {}).get('work_order_id')} {ret.get('work_order_status', 'closed')}"
                             + (f" by {ret['closed_by']}" if ret.get("closed_by") else "") + f". {state['vehicle_label']} is back on the schedule." + defect_note)
    await set_step(state["workflow_id"], "return_to_service", "done", "Back on the schedule" + (", defect cleared" if defect_note.endswith("cleared.") else ""),
                   returned_at=now())
    return {"outcome": "completed"}


# ---------------------------------------------------------------- compensation + finish
def _run_label(state: WorkflowState, run_id: str) -> str:
    """Route and block of a run in this orchestration, for messages people read."""
    for r in (state.get("assignments") or []) + ((state.get("assessment") or {}).get("runs_at_risk") or []):
        if r.get("run_id") == run_id:
            return f"{r['route_name']} {r['block_name']}"
    return "the run"


async def compensate(state: WorkflowState) -> dict:
    f = state.get("failure") or {}
    if f.get("escalate_only"):
        return {}
    rules = await _rules(state)
    comp_rules = rules["compensation"]
    done: list[dict] = []
    wo_cancelled = False
    for act in reversed(state.get("completed_actions", [])):
        step = act.get("step") or f.get("step")
        try:
            if act["action"] == "assign_run":
                await _delegate(state, rules, step, "trip", "revert_run", lambda ctx, a=act: adapters.trip.revert_run(
                    ctx, run_id=a["run_id"], idempotency_key=f"{state['workflow_id']}:comp:revert:{a['run_id']}"), requires=["trip_mgmt.revert_run"], decision={})
                done.append({"action": "revert_run", "run_id": act["run_id"], "text": f"moved {_run_label(state, act['run_id'])} back to {state['vehicle_label']}"})
            elif act["action"] == "block_vehicle" and comp_rules.get("restore_vehicle_on_reassign_failure", True):
                await _delegate(state, rules, step, "trip", "restore_vehicle", lambda ctx, a=act: adapters.trip.unblock_vehicle(
                    ctx, ref=a["ref"], reason="Compensation: later step failed", idempotency_key=f"{state['workflow_id']}:comp:unblock"),
                    requires=["trip_mgmt.unblock_vehicle"], decision={})
                done.append({"action": "restore_vehicle", "vehicle": state["vehicle_label"], "text": f"put {state['vehicle_label']} back on the schedule"})
                await set_step(state["workflow_id"], "pull_vehicle", "compensated", "Vehicle restored to the schedule after a later step failed")
            elif act["action"] == "open_defect" and wo_cancelled:
                await _delegate(state, rules, step, "safety", "clear_defect", lambda ctx, a=act: adapters.safety.close_defect(
                    ctx, defect_id=a["defect_id"], resolution="Work order cancelled by compensation",
                    idempotency_key=f"{state['workflow_id']}:comp:close_defect"), requires=["safety.close_defect"], decision={})
                done.append({"action": "clear_defect", "defect_id": act["defect_id"], "text": f"cleared defect {act['defect_id']} in Vestige"})
            elif act["action"] == "create_work_order" and comp_rules.get("cancel_work_order_on_failure", False):
                await _delegate(state, rules, step, "asset", "cancel_work_order", lambda ctx, a=act: adapters.asset.cancel_work_order(
                    ctx, a["work_order_id"], "Compensation: workflow could not complete"), requires=["asset_mgmt.cancel_work_order"], decision={})
                done.append({"action": "cancel_work_order", "work_order_id": act["work_order_id"], "text": f"cancelled work order {act['work_order_id']}"})
                wo_cancelled = True
                await set_step(state["workflow_id"], "open_work_order", "compensated", "Work order cancelled")
        except Exception as e:
            log.exception("compensation step failed")
            done.append({"action": f"FAILED {act['action']}", "error": str(e), "text": f"could not undo {act['action'].replace('_', ' ')} ({e})"})
    kept_wo = state.get("work_order") and not comp_rules.get("cancel_work_order_on_failure", False)
    undone = "; ".join(d.get("text", d["action"]) for d in done)
    expl = (f"{f.get('step', '').replace('_', ' ').capitalize()} failed: {f.get('message')}. To keep the products in sync the agent "
            + (undone if done else "had nothing to undo")
            + (f"; work order {state['work_order']['work_order_id']} kept open for the shop." if kept_wo else "."))
    await _audit(state, record_type="compensation", step=f.get("step"), outcome="compensated", recommendation={"actions": done}, explanation=expl)
    return {"compensation": done}


async def finish(state: WorkflowState) -> dict:
    return {}


# ---------------------------------------------------------------- wiring
def _after_exec(step: str, next_node: str):
    def route(state: WorkflowState) -> str:
        f = state.get("failure")
        if f and f.get("step") == step:
            return "compensate"
        return next_node
    return route


def _stop_after_wo_gate(state: WorkflowState) -> str:
    return "finish"


def _stop_after_pull_gate(state: WorkflowState) -> str:
    return "await_work_order_close" if state.get("work_order") else "finish"


def _stop_after_reassign_gate(state: WorkflowState) -> str:
    d = _decision(state, "reassign_runs").get("decision")
    if d == "rejected" and state.get("block"):
        return "restore_after_reject"
    return "gate_notify_riders" if d in ("skipped", "escalated") else "await_work_order_close"


async def restore_after_reject(state: WorkflowState) -> dict:
    """Dispatcher rejected the cover plan: put the vehicle back so no run is left without one."""
    rules = await _rules(state)
    try:
        await _delegate(state, rules, "pull_vehicle", "trip", "restore_vehicle", lambda ctx: adapters.trip.unblock_vehicle(
            ctx, ref=state["workflow_id"], reason="Cover plan rejected by dispatcher", idempotency_key=f"{state['workflow_id']}:restore_after_reject"),
            requires=["trip_mgmt.unblock_vehicle"])
    except (ProductAPIError, PolicyViolation) as e:
        await _audit(state, record_type="action_failed", step="pull_vehicle", outcome="failed", explanation=str(e))
        return {"failure": {"step": "pull_vehicle", "message": str(e), "escalate_only": True, "at": now().isoformat()}}
    await _audit(state, record_type="compensation", step="pull_vehicle", outcome="vehicle_restored",
                 explanation=f"Cover plan was rejected, so {state['vehicle_label']} was put back on its runs. Work order stays open; dispatcher to plan cover manually.")
    await set_step(state["workflow_id"], "pull_vehicle", "compensated", "Restored after cover plan was rejected")
    return {"block": None, "halted_at": "reassign_runs"}


def build_graph() -> StateGraph:
    g = StateGraph(WorkflowState)
    g.add_node("assess", assess_node)
    for step in ("open_work_order", "pull_vehicle", "notify_riders", "return_to_service"):
        g.add_node(f"gate_{step}", make_gate(step))
    g.add_node("gate_reassign_runs", make_reassign_gate())
    g.add_node("exec_open_work_order", exec_open_work_order)
    g.add_node("exec_pull_vehicle", exec_pull_vehicle)
    g.add_node("exec_reassign_runs", exec_reassign_runs)
    g.add_node("exec_notify_riders", exec_notify_riders)
    g.add_node("await_work_order_close", await_work_order_close)
    g.add_node("exec_return_to_service", exec_return_to_service)
    g.add_node("restore_after_reject", restore_after_reject)
    g.add_node("compensate", compensate)
    g.add_node("finish", finish)

    g.add_edge(START, "assess")
    g.add_edge("assess", "gate_open_work_order")
    g.add_conditional_edges("gate_open_work_order", route_after_gate("open_work_order", "exec_open_work_order", _stop_after_wo_gate, "gate_pull_vehicle"),
                            ["exec_open_work_order", "gate_pull_vehicle", "finish"])
    g.add_conditional_edges("exec_open_work_order", _after_exec("open_work_order", "gate_pull_vehicle"), ["compensate", "gate_pull_vehicle"])
    g.add_conditional_edges("gate_pull_vehicle", route_after_gate("pull_vehicle", "exec_pull_vehicle", _stop_after_pull_gate, "gate_reassign_runs"),
                            ["exec_pull_vehicle", "gate_reassign_runs", "await_work_order_close", "finish"])
    g.add_conditional_edges("exec_pull_vehicle", _after_exec("pull_vehicle", "gate_reassign_runs"), ["compensate", "gate_reassign_runs"])
    g.add_conditional_edges("gate_reassign_runs", route_after_gate("reassign_runs", "exec_reassign_runs", _stop_after_reassign_gate, "gate_notify_riders"),
                            ["exec_reassign_runs", "restore_after_reject", "gate_notify_riders", "await_work_order_close"])
    g.add_conditional_edges("exec_reassign_runs", _after_exec("reassign_runs", "gate_notify_riders"), ["compensate", "gate_notify_riders"])
    g.add_edge("restore_after_reject", "await_work_order_close")
    g.add_conditional_edges("gate_notify_riders", route_after_gate("notify_riders", "exec_notify_riders", "await_work_order_close"),
                            ["exec_notify_riders", "await_work_order_close"])
    g.add_edge("exec_notify_riders", "await_work_order_close")
    g.add_edge("await_work_order_close", "gate_return_to_service")
    g.add_conditional_edges("gate_return_to_service", route_after_gate("return_to_service", "exec_return_to_service", "finish"),
                            ["exec_return_to_service", "finish"])
    g.add_edge("exec_return_to_service", "finish")

    def after_compensate(state: WorkflowState) -> str:
        # Keep the loop open for the shop if a work order still exists, so return to service is still logged.
        return "await_work_order_close" if state.get("work_order") and (state.get("failure") or {}).get("step") != "open_work_order" else "finish"

    g.add_conditional_edges("compensate", after_compensate, ["await_work_order_close", "finish"])
    g.add_edge("finish", END)
    return g
