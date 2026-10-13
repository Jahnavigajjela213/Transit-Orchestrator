"""TEMPLATE for a new cross-product workflow. Copy to orchestrator/<your_workflow>.py and follow docs/PATTERN_GUIDE.md.

The example is deliberately small and complete: a product event starts it, the supervisor asks domain agents for the
facts, one write step is gated by policy (approve / agent acts / shadow / recommend only), a rider-notification step
follows, and the outcome is logged. Everything marked TODO is what you change. tests/test_template.py compiles it so the
template never drifts from the real APIs.

    1 Detect -> 2 Assess -> 3 Act (gate) -> 4 Notify (gate) -> 5 Log
"""
from typing import Any, Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from app.adapters.registry import adapters
from app.agents import supervisor
from app.core.clock import now
from app.core.errors import PolicyViolation, ProductAPIError
from app.orchestrator.graph import GO, _approved_by, _audit, _decision, _delegate, _read, _rules, make_gate
from app.orchestrator.tracking import set_step

WORKFLOW_TYPE = "example_workflow"  # TODO: your workflow type; add it to policy/defaults.py (STEPS_BY_TYPE, DEFAULT_RULES)


class ExampleState(TypedDict, total=False):  # TODO: rename; keep the shared keys, add your own
    workflow_id: str
    workflow_type: str
    tenant_id: str
    trace_id: str
    trigger_event_id: str
    trigger_type: str
    trigger: dict[str, Any]
    vehicle_id: Optional[str]
    vehicle_label: Optional[str]
    assessment: dict[str, Any]
    decisions: dict[str, dict[str, Any]]
    result: Optional[dict[str, Any]]
    completed_actions: list[dict[str, Any]]
    failure: Optional[dict[str, Any]]
    outcome: str


# ---------------------------------------------------------------- 2. assess: facts come from domain agents, never from products directly
async def assess_node(state: ExampleState) -> dict:
    await set_step(state["workflow_id"], "detect", "done", f"Received {state['trigger_type']}", "autonomous")
    await set_step(state["workflow_id"], "assess", "active", "Gathering facts", "autonomous")
    rules = await _rules(state)
    vehicle = await _read(state, rules, "trip", "read_vehicle", lambda ctx: adapters.trip.vehicle(ctx, state["vehicle_id"]))
    health = await _read(state, rules, "asset", "vehicle_health", lambda ctx: adapters.asset.vehicle_health(ctx, state["vehicle_id"]))
    # TODO: deterministic checks belong here, in code. The LLM may explain and choose among options that passed them.
    a = {"vehicle": vehicle, "health": health, "severity": "medium", "summary": f"{state['vehicle_label']}: example assessment."}
    await _audit(state, record_type="assessment", step="assess", autonomy_level="autonomous", outcome="assessed",
                 data_considered={"vehicle": vehicle, "health": health}, recommendation={"action": "example"}, explanation=a["summary"])
    await set_step(state["workflow_id"], "assess", "done", "Facts gathered", "autonomous", summary=a["summary"],
                   context={"assessment": a, "agent_plan": supervisor.plan(WORKFLOW_TYPE)})
    return {"assessment": a}


# ---------------------------------------------------------------- 3/4. gates reuse make_gate: policy decides the level per tenant and step
def _recommend(state: ExampleState, step: str) -> dict:
    return {"step": step, "vehicle_label": state.get("vehicle_label")}  # TODO: what the approver sees and can change


def _options(state: ExampleState, step: str) -> dict:
    return {}  # TODO: alternatives the person may pick from (validated in orchestrator/approvals.py::_validate_override)


def _skip(state: ExampleState, step: str) -> str:
    return ""  # TODO: a reason string skips the step (e.g. nothing to notify)


async def exec_act(state: ExampleState) -> dict:
    d = _decision(state, "act")
    rules = await _rules(state)
    try:
        # TODO: the write, delegated to the agent that owns the product, with the permission(s) it needs.
        res = await _delegate(state, rules, "act", "trip", "example_write", lambda ctx: adapters.trip.vehicle(ctx, state["vehicle_id"]),
                              requires=[])
    except (ProductAPIError, PolicyViolation) as e:
        await _audit(state, record_type="action_failed", step="act", outcome="failed", explanation=str(e))
        await set_step(state["workflow_id"], "act", "failed", str(e))
        return {"failure": {"step": "act", "message": str(e), "at": now().isoformat()}}
    await _audit(state, record_type="action_executed", step="act", autonomy_level=d.get("level"), outcome="done",
                 recommendation={"result": "example"}, explanation="Example action done." + _approved_by(d),
                 human_action=d.get("decision") if d.get("decision") != "auto" else None)
    await set_step(state["workflow_id"], "act", "done", "Done")
    return {"result": {"vehicle": res.get("label") if isinstance(res, dict) else None},
            "completed_actions": state.get("completed_actions", []) + [{"step": "act", "action": "example_write"}]}


async def exec_notify(state: ExampleState) -> dict:
    await set_step(state["workflow_id"], "notify", "done", "Nobody to notify in the template")  # TODO: rider_comms agent
    return {}


async def close_node(state: ExampleState) -> dict:
    await _audit(state, record_type="action_executed", step="close", autonomy_level="autonomous", outcome="logged",
                 recommendation={"result": state.get("result")}, explanation="Example workflow finished.")
    await set_step(state["workflow_id"], "close", "done", "Logged")
    return {"outcome": "completed"}


def _after_gate(step: str, exec_node: str):
    def route(state: ExampleState) -> str:
        return exec_node if _decision(state, step).get("decision") in GO else "close"  # shadow / reject / informational -> close
    return route


def _after_act(state: ExampleState) -> str:
    return "close" if (state.get("failure") or {}).get("step") == "act" else "gate_notify"  # TODO: compensation node if needed


def build_graph() -> StateGraph:
    g = StateGraph(ExampleState)
    g.add_node("assess", assess_node)
    g.add_node("gate_act", make_gate("act", _recommend, _options, _skip))
    g.add_node("exec_act", exec_act)
    g.add_node("gate_notify", make_gate("notify", _recommend, _options, _skip))
    g.add_node("exec_notify", exec_notify)
    g.add_node("close", close_node)
    g.add_edge(START, "assess")
    g.add_edge("assess", "gate_act")
    g.add_conditional_edges("gate_act", _after_gate("act", "exec_act"), ["exec_act", "close"])
    g.add_conditional_edges("exec_act", _after_act, ["gate_notify", "close"])
    g.add_conditional_edges("gate_notify", _after_gate("notify", "exec_notify"), ["exec_notify", "close"])
    g.add_edge("exec_notify", "close")
    g.add_edge("close", END)
    return g
