"""Domain agents: one per product area, each a small LangGraph graph (check -> act -> report).

An agent can only touch its own product. Before it acts, `check` narrows the action context to that product's
actions and verifies the persona it serves holds every permission the task needs, so a task fails before any
partial write when the persona is not allowed. `act` runs the task through the product adapter (idempotent,
retried, rate limited). `report` times the task and hands the result back to the supervisor.
"""
import time
from dataclasses import replace
from typing import Any, Awaitable, Callable, Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from app.adapters.base import ActionContext
from app.core.errors import PolicyViolation

TaskFn = Callable[[ActionContext], Awaitable[Any]]


class AgentTaskState(TypedDict, total=False):
    task: str
    persona: str
    requires: list[str]
    ctx: ActionContext
    fn: TaskFn
    result: Any
    started: float
    duration_ms: int


class DomainAgent:
    def __init__(self, key: str, name: str, system: str, product: str, responsibilities: list[str]):
        self.key, self.name, self.system, self.product = key, name, system, product
        self.responsibilities = responsibilities
        self.graph = self._build()

    def describe(self) -> dict:
        return {"key": self.key, "name": self.name, "system": self.system, "product": self.product, "responsibilities": self.responsibilities}

    # -------------------------------------------------------------- graph
    def _build(self):
        g = StateGraph(AgentTaskState)
        g.add_node("check", self._check)
        g.add_node("act", self._act)
        g.add_node("report", self._report)
        g.add_edge(START, "check")
        g.add_edge("check", "act")
        g.add_edge("act", "report")
        g.add_edge("report", END)
        return g.compile(checkpointer=False)  # runs inside one parent step; must not inherit the workflow checkpointer

    async def _check(self, st: AgentTaskState) -> dict:
        ctx = st["ctx"]
        prefix = f"{self.system}."
        if "*" in ctx.allowed_actions:
            scoped = {"*"}
        else:
            scoped = {a for a in ctx.allowed_actions if a.startswith(prefix)}
        for action in st.get("requires") or []:
            if not action.startswith(prefix):
                raise PolicyViolation(f"{self.name} cannot perform {action}: it only acts on {self.product}")
            if "*" not in scoped and action not in scoped:
                raise PolicyViolation(f"{self.name} acting for the {st['persona'].replace('_', ' ')} persona is not permitted to perform {action}")
        # The agent only ever holds its own product's permissions, so it cannot write anywhere else.
        agent_ctx = replace(ctx, actor=f"{ctx.actor}/{self.key}", allowed_actions={"*"} if "*" in scoped else scoped)
        if "*" in scoped:  # admin persona: still confine the wildcard to this product
            agent_ctx = replace(agent_ctx, allowed_actions={a for a in _system_actions(self.system)})
        return {"ctx": agent_ctx, "started": time.perf_counter()}

    async def _act(self, st: AgentTaskState) -> dict:
        return {"result": await st["fn"](st["ctx"])}

    async def _report(self, st: AgentTaskState) -> dict:
        return {"duration_ms": int((time.perf_counter() - st["started"]) * 1000)}

    async def run(self, task: str, fn: TaskFn, ctx: ActionContext, *, persona: str, requires: Optional[list[str]] = None) -> tuple[Any, int]:
        out = await self.graph.ainvoke({"task": task, "persona": persona, "requires": requires or [], "ctx": ctx, "fn": fn})
        return out.get("result"), out.get("duration_ms", 0)


def _system_actions(system: str) -> set[str]:
    from app.policy.defaults import ALL_PERMISSIONS

    return {a for a in ALL_PERMISSIONS if a.startswith(f"{system}.")}


AGENTS: dict[str, DomainAgent] = {
    a.key: a for a in (
        DomainAgent("asset", "Asset agent", "asset_mgmt", "FASTER (asset management)",
                    ["fault classification and vehicle health", "shop window", "open, cancel and track work orders"]),
        DomainAgent("trip", "Trip agent", "trip_mgmt", "Ecolane / TripMaster (trip management)",
                    ["runs at risk and spare fleet", "pull and return vehicles", "reassign runs", "ETAs, standby bookings"]),
        DomainAgent("workforce", "Workforce agent", "workforce", "Bytecurve (workforce)",
                    ["driver roster, licences, certifications, hours"]),
        DomainAgent("safety", "Safety agent", "safety", "Vestige (safety & compliance)",
                    ["driver compliance (medical card, drug test, training, suspension)", "vehicle defect records"]),
        DomainAgent("rider_comms", "Rider comms agent", "rider_comms", "TripShot / Passio (rider communications)",
                    ["rider notifications in each rider's language and channel"]),
    )
}
