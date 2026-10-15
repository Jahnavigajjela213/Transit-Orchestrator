"""Supervisor: plans which domain agent handles each step, and delegates every product call to it.

The LangGraph workflow graph is the supervisor's control flow (gates, pauses, compensation). Inside a step,
the supervisor never calls a product itself: it picks the persona the agent serves (the person who approved the
step, or the policy's `acts_as` persona when the agent acts on its own), works out the effective permissions
(agent grant AND persona grant), and delegates the task to the owning domain agent. Every delegation is kept on
the workflow (shown as "Agents" on the orchestration screen) and traced.
"""
from typing import Any, Optional

from app.adapters.base import ActionContext
from app.agents.domain import AGENTS, TaskFn
from app.core.clock import now
from app.core.database import session_scope
from app.core.logging import get_logger
from app.core.realtime import hub
from app.core.tracing import span
from app.models import Tenant, Workflow
from app.policy.engine import policy_engine

log = get_logger("supervisor")

# Which agent owns which part of each step. Read-only consults are listed with the step they inform.
ROUTING: dict[str, dict[str, list[tuple[str, str]]]] = {
    "vehicle_health": {
        "detect": [("asset", "Identify the fault and read the vehicle's health in FASTER")],
        "assess": [("asset", "Rate the severity and find a shop window")],
        "open_work_order": [("asset", "Open the work order in FASTER"), ("safety", "Record the vehicle defect in Vestige")],
        "pull_vehicle": [("trip", "Find the runs that lose this vehicle and mark it unavailable in trip management")],
        "reassign_runs": [("workforce", "Find a driver with the right licence, certifications and hours for the spare vehicle"),
                          ("safety", "Check the spare vehicle has no open defects and the driver is compliant"),
                          ("trip", "Put the spare vehicle and driver on the affected runs")],
        "notify_riders": [("rider_comms", "Tell affected riders in their language and preferred channel"), ("trip", "Update pickup ETAs")],
        "return_to_service": [("asset", "Confirm the work order is closed"), ("trip", "Return the vehicle to the schedule"),
                              ("safety", "Clear the vehicle defect")],
    },
    "no_show_recovery": {
        "assess": [("trip", "Read the run, the missed pickup, standby requests and the rider's no-show history")],
        "adjust_schedule": [("trip", "Book a standby rider or re-time later pickups")],
        "notify_riders": [("rider_comms", "Notify riders")],
    },
}


class Supervisor:
    def plan(self, workflow_type: str) -> list[dict[str, Any]]:
        return [{"step": step, "agents": [{"agent": AGENTS[k].name, "key": k, "task": t, "product": AGENTS[k].product} for k, t in items]}
                for step, items in ROUTING.get(workflow_type, {}).items()]

    @staticmethod
    def persona_for(rules: dict, step: str, decision: Optional[dict] = None) -> str:
        d = decision or {}
        if d.get("decision") in ("approved", "overridden") and d.get("role"):
            return d["role"]
        return policy_engine.acts_as(rules, step)

    async def context(self, state: dict, rules: dict, persona: str) -> ActionContext:
        async with session_scope() as s:
            tenant = await s.get(Tenant, state["tenant_id"])
        return ActionContext(tenant_id=state["tenant_id"], actor=tenant.agent_persona if tenant else "orchestrator-agent",
                             workflow_id=state["workflow_id"], trace_id=state.get("trace_id"),
                             allowed_actions=policy_engine.effective_permissions(rules, persona))

    async def delegate(self, state: dict, rules: dict, step: str, agent_key: str, task: str, fn: TaskFn, *,
                       persona: str, requires: Optional[list[str]] = None) -> Any:
        agent = AGENTS[agent_key]
        ctx = await self.context(state, rules, persona)
        started = now()
        error: Optional[str] = None
        ms = 0
        try:
            with span(f"agent.{agent_key}.{task}", tenant=state["tenant_id"], workflow=state["workflow_id"], step=step, persona=persona,
                      trace_id=state.get("trace_id")):
                result, ms = await agent.run(task, fn, ctx, persona=persona, requires=requires)
            return result
        except Exception as e:  # noqa: BLE001  (recorded, then re-raised to the step)
            error, ms = str(getattr(e, "message", e)), int((now() - started).total_seconds() * 1000)
            raise
        finally:
            await self._record(state["workflow_id"], {"step": step, "agent": agent.name, "key": agent_key, "task": task, "persona": persona,
                                                      "requires": requires or [], "status": "failed" if error else "done", "error": error,
                                                      "at": started.isoformat(), "duration_ms": ms})

    @staticmethod
    async def _record(workflow_id: str, entry: dict) -> None:
        async with session_scope() as s:
            wf = await s.get(Workflow, workflow_id)
            if not wf:
                return
            ctx = dict(wf.context or {})
            ctx["delegations"] = (ctx.get("delegations") or []) + [entry]
            wf.context = ctx
            tenant_id = wf.tenant_id
        hub.publish(tenant_id, "workflow", {"id": workflow_id, "delegation": entry["task"]})


supervisor = Supervisor()
