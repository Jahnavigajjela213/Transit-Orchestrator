"""Keeps the workflow row (status, step timeline) in sync and broadcasts changes live."""
from typing import Any, Optional

from app.core.clock import now
from app.core.database import session_scope
from app.core.realtime import hub
from app.models import Workflow
from app.policy.defaults import STEPS_BY_TYPE


def initial_steps(workflow_type: str = "vehicle_health") -> list[dict[str, Any]]:
    return [{"key": k, "label": label, "description": d, "status": "pending", "level": None, "detail": "", "at": None}
            for k, label, d in STEPS_BY_TYPE[workflow_type]]


async def set_step(workflow_id: str, step: str, status: str, detail: str = "", level: Optional[str] = None, **fields: Any) -> None:
    async with session_scope() as s:
        wf = await s.get(Workflow, workflow_id)
        if not wf:
            return
        steps = [dict(x) for x in wf.steps]
        for x in steps:
            if x["key"] == step:
                x["status"] = status
                if detail:
                    x["detail"] = detail
                if level:
                    x["level"] = level
                x["at"] = now().isoformat()
        wf.steps = steps
        wf.current_step = step
        _apply(wf, fields)
        tenant_id = wf.tenant_id
    hub.publish(tenant_id, "workflow", {"id": workflow_id, "step": step, "step_status": status})


async def update_workflow(workflow_id: str, **fields: Any) -> None:
    async with session_scope() as s:
        wf = await s.get(Workflow, workflow_id)
        if not wf:
            return
        _apply(wf, fields)
        tenant_id = wf.tenant_id
        status = wf.status
    hub.publish(tenant_id, "workflow", {"id": workflow_id, "status": status})


def _apply(wf: Workflow, fields: dict[str, Any]) -> None:
    """Set columns; `context` is merged key by key so concurrent writers do not drop each other's data."""
    for k, v in fields.items():
        if k == "context":
            wf.context = {**(wf.context or {}), **v}
        else:
            setattr(wf, k, v)
