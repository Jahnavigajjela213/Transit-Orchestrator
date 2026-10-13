"""OrchestratorService: listens on the event backbone and drives workflow graphs.

- Trigger events (vehicle.fault.detected, vehicle.pm.overdue) start a workflow, or are
  attached to the vehicle's active workflow (no duplicate orchestrations).
- orchestrator.approval.decided resumes a paused gate with the person's decision.
- workorder.closed / workorder.cancelled resumes the "waiting for the shop" pause.
- trip.no_show / trip.cancelled start a No-Show Recovery workflow.
- manual product actions (work orders, pulls, reassignments, rider messages opened by people) feed the
  shadow-mode comparison and the manual re-entry measure.
All transitions are serialized by the single event-bus worker.
"""
from typing import Any, Optional

from langgraph.types import Command
from sqlalchemy import select

from app.audit import service as audit
from app.core.clock import new_id, now, precise_now
from app.core.config import settings
from app.core.database import session_scope
from app.core.event_bus import bus
from app.core.events import CloudEvent, EventTypes
from app.core.logging import get_logger
from app.core.realtime import hub
from app.core.tracing import new_trace_id, span
from app.identity.service import identity
from app.llm.router import llm
from app.models import ApprovalRequest, Workflow
from app.orchestrator import assessment as A
from app.orchestrator import noshow, shadow
from app.orchestrator.graph import WORKFLOW_TYPE, build_graph
from app.orchestrator.tracking import initial_steps, update_workflow

log = get_logger("orchestrator")
ACTIVE = ("running", "awaiting_approval", "awaiting_event")
TITLES = {
    "open_work_order": "Open work order for {v}",
    "pull_vehicle": "Pull {v} from the schedule",
    "reassign_runs": "Cover {n} run(s) for {v}",
    "notify_riders": "Notify riders about {v}",
    "return_to_service": "Return {v} to service",
}


class OrchestratorService:
    def __init__(self) -> None:
        self._saver_cm = None
        self.graphs: dict[str, Any] = {}
        self._subscribed = False

    @property
    def graph(self):
        return self.graphs.get(WORKFLOW_TYPE)

    async def start(self) -> None:
        if settings.is_postgres:
            from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

            self._saver_cm = AsyncPostgresSaver.from_conn_string(settings.psycopg_url)
            saver = await self._saver_cm.__aenter__()
            await saver.setup()  # creates checkpoint tables on first run
        else:
            from pathlib import Path

            from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

            Path(settings.checkpoint_db_path).parent.mkdir(parents=True, exist_ok=True)
            self._saver_cm = AsyncSqliteSaver.from_conn_string(settings.checkpoint_db_path)
            saver = await self._saver_cm.__aenter__()
        self.graphs = {WORKFLOW_TYPE: build_graph().compile(checkpointer=saver),
                       noshow.WORKFLOW_TYPE: noshow.build_graph().compile(checkpointer=saver)}
        if self._subscribed:
            return
        self._subscribed = True
        bus.subscribe(EventTypes.TRIP_NO_SHOW, self.on_no_show)
        bus.subscribe(EventTypes.TRIP_CANCELLED, self.on_no_show)
        bus.subscribe(EventTypes.VEHICLE_FAULT_DETECTED, self.on_trigger)
        bus.subscribe(EventTypes.VEHICLE_PM_OVERDUE, self.on_trigger)
        bus.subscribe(EventTypes.APPROVAL_DECIDED, self.on_approval_decided)
        bus.subscribe(EventTypes.WORK_ORDER_CLOSED, self.on_work_order_finished)
        bus.subscribe(EventTypes.WORK_ORDER_CANCELLED, self.on_work_order_finished)
        for etype in shadow.WATCHED:  # manual product actions: shadow comparison and manual re-entry count
            bus.subscribe(etype, shadow.on_product_event)

    async def stop(self) -> None:
        if self._saver_cm:
            await self._saver_cm.__aexit__(None, None, None)
            self._saver_cm = None

    @staticmethod
    def _cfg(workflow_id: str) -> dict:
        return {"configurable": {"thread_id": workflow_id}, "recursion_limit": 60}

    async def _graph_for(self, workflow_id: str):
        async with session_scope() as s:
            wf = await s.get(Workflow, workflow_id)
            wtype = wf.workflow_type if wf else WORKFLOW_TYPE
        return self.graphs[wtype]

    # ------------------------------------------------------------ no-show trigger
    async def on_no_show(self, event: CloudEvent) -> None:
        tenant_id = event.tenantid
        d = event.data
        async with session_scope() as s:
            from app.models import FleetVehicle, Run

            run = await s.get(Run, d["run_id"])
            fv = await s.get(FleetVehicle, run.vehicle_code) if run and run.vehicle_code else None
            vehicle_id = await identity.to_canonical(s, tenant_id, "trip_mgmt", run.vehicle_code) if fv else None
            label = fv.label if fv else None
            kind = "No-show" if d.get("kind", "no_show") == "no_show" else "Late cancellation"
            wf = Workflow(
                id=new_id("wf"), tenant_id=tenant_id, workflow_type=noshow.WORKFLOW_TYPE, status="running", current_step="detect",
                vehicle_id=vehicle_id, vehicle_label=label, trigger_event_id=event.id, trigger_type=event.type,
                title=f"{kind} on {run.route_name if run else d['run_id']}", steps=initial_steps(noshow.WORKFLOW_TYPE), context={},
                trace_id=event.traceid or new_trace_id(), detected_at=event.time, started_at=precise_now(),
            )
            s.add(wf)
            await s.flush()
            await audit.record(s, tenant_id=tenant_id, workflow_id=wf.id, record_type="event_received", step="detect", triggering_event_id=event.id,
                               actor=event.source, actor_type="product", outcome="workflow_started", data_considered={"type": event.type, "data": d},
                               trace_id=wf.trace_id, explanation=f"{event.type} for trip {d['trip_id']} started a no-show recovery orchestration.")
            workflow_id, trace_id = wf.id, wf.trace_id
        hub.publish(tenant_id, "workflow", {"id": workflow_id, "status": "running"})
        state = {"workflow_id": workflow_id, "workflow_type": noshow.WORKFLOW_TYPE, "tenant_id": tenant_id, "trace_id": trace_id,
                 "trigger_event_id": event.id, "trigger_type": event.type, "trigger": d, "vehicle_id": vehicle_id, "vehicle_label": label,
                 "decisions": {}, "completed_actions": []}
        with span("workflow.start", trace_id=trace_id, workflow=workflow_id, tenant=tenant_id):
            await self._invoke(workflow_id, state)

    # ------------------------------------------------------------ triggers
    async def on_trigger(self, event: CloudEvent) -> None:
        tenant_id = event.tenantid
        async with session_scope() as s:
            vehicle_id = event.subject
            if not vehicle_id and event.data.get("device_id"):
                vehicle_id = await identity.to_canonical(s, tenant_id, "telematics", event.data["device_id"])
            if not vehicle_id and event.data.get("asset_number"):
                vehicle_id = await identity.to_canonical(s, tenant_id, "asset_mgmt", event.data["asset_number"])
            if not vehicle_id:
                raise ValueError(f"Could not resolve a vehicle for event {event.id}")
            label = await identity.label(s, vehicle_id) or vehicle_id
            active = (
                await s.execute(select(Workflow).where(Workflow.tenant_id == tenant_id, Workflow.vehicle_id == vehicle_id,
                                                       Workflow.workflow_type == WORKFLOW_TYPE, Workflow.status.in_(ACTIVE)).limit(1))
            ).scalar_one_or_none()
            if active:
                await audit.record(s, tenant_id=tenant_id, workflow_id=active.id, record_type="event_received", step="detect",
                                   triggering_event_id=event.id, actor=event.source, actor_type="product", outcome="attached_to_active_workflow",
                                   data_considered={"type": event.type, "data": event.data}, trace_id=active.trace_id,
                                   explanation=f"{label} already has an active orchestration; new signal attached to it instead of starting another.")
                ctx = dict(active.context or {})
                ctx.setdefault("additional_signals", []).append({"event_id": event.id, "type": event.type, "data": event.data, "at": now().isoformat()})
                active.context = ctx
                hub.publish(tenant_id, "workflow", {"id": active.id, "status": active.status})
                return
            wf = Workflow(
                id=new_id("wf"), tenant_id=tenant_id, workflow_type=WORKFLOW_TYPE, status="running", current_step="detect",
                vehicle_id=vehicle_id, vehicle_label=label, trigger_event_id=event.id, trigger_type=event.type,
                title=f"{label}: {event.data.get('description') or event.type}", steps=initial_steps(), context={},
                trace_id=event.traceid or new_trace_id(), detected_at=event.time, started_at=precise_now(),
            )
            s.add(wf)
            await s.flush()
            await audit.record(s, tenant_id=tenant_id, workflow_id=wf.id, record_type="event_received", step="detect", triggering_event_id=event.id,
                               actor=event.source, actor_type="product", outcome="workflow_started", data_considered={"type": event.type, "data": event.data},
                               trace_id=wf.trace_id, explanation=f"{event.type} for {label} started a {WORKFLOW_TYPE} orchestration.")
            workflow_id, trace_id = wf.id, wf.trace_id
        hub.publish(tenant_id, "workflow", {"id": workflow_id, "status": "running"})
        state = {"workflow_id": workflow_id, "workflow_type": WORKFLOW_TYPE, "tenant_id": tenant_id, "trace_id": trace_id, "trigger_event_id": event.id,
                 "trigger_type": event.type, "trigger": event.data, "vehicle_id": vehicle_id, "vehicle_label": label,
                 "decisions": {}, "completed_actions": [], "assignments": []}
        with span("workflow.start", trace_id=trace_id, workflow=workflow_id, tenant=tenant_id):
            await self._invoke(workflow_id, state)

    # ------------------------------------------------------------ resumes
    async def on_approval_decided(self, event: CloudEvent) -> None:
        wf_id = event.data["workflow_id"]
        st = await (await self._graph_for(wf_id)).aget_state(self._cfg(wf_id))
        pending = await self._pending(wf_id, st)
        if not pending or pending.get("type") != "approval" or pending.get("step") != event.data["step"]:
            log.warning("approval for %s/%s no longer matches the paused step; ignored", wf_id, event.data["step"])
            return
        await update_workflow(wf_id, status="running")
        resume = {k: event.data.get(k) for k in ("decision", "actor", "actor_id", "role", "note", "override", "approval_id")}
        async with session_scope() as s:
            wf_row = await s.get(Workflow, wf_id)
            trace_id = wf_row.trace_id if wf_row else None
        with span("workflow.resume", trace_id=trace_id, workflow=wf_id, step=event.data["step"]):
            await self._invoke(wf_id, Command(resume=resume))

    async def on_work_order_finished(self, event: CloudEvent) -> None:
        wo_id = event.data.get("work_order_id")
        wf_id = event.data.get("external_ref")
        async with session_scope() as s:
            q = select(Workflow).where(Workflow.tenant_id == event.tenantid, Workflow.workflow_type == WORKFLOW_TYPE, Workflow.status.in_(ACTIVE))
            q = q.where(Workflow.id == wf_id) if wf_id else q.where(Workflow.vehicle_id == event.subject)
            wf = (await s.execute(q.limit(1))).scalar_one_or_none()
            if not wf:
                return
            wf_id = wf.id
            await audit.record(s, tenant_id=wf.tenant_id, workflow_id=wf.id, record_type="event_received", step="return_to_service",
                               triggering_event_id=event.id, actor=event.data.get("closed_by") or event.source, actor_type="product",
                               outcome=event.type, data_considered=event.data, trace_id=wf.trace_id,
                               explanation=f"{wo_id} {event.type.split('.')[-1]} in asset management.")
        st = await (await self._graph_for(wf_id)).aget_state(self._cfg(wf_id))
        pending = await self._pending(wf_id, st)
        if pending and pending.get("type") == "await_event" and pending.get("work_order_id") == wo_id:
            await update_workflow(wf_id, status="running")
            resume = {"work_order_status": "closed" if event.type == EventTypes.WORK_ORDER_CLOSED else "cancelled",
                      "closed_by": event.data.get("closed_by"), "resolution": event.data.get("resolution") or event.data.get("reason")}
            await self._invoke(wf_id, Command(resume=resume))
        # If the workflow is still at an approval gate, await_work_order_close will see the closed WO when reached.

    # ------------------------------------------------------------ engine
    @staticmethod
    def _interrupt(st) -> Optional[dict]:
        for t in st.tasks or []:
            for i in t.interrupts or []:
                return i.value
        return None

    async def _pending(self, workflow_id: str, st) -> Optional[dict]:
        """The paused step's payload. After a restart the checkpoint still knows *which* node is
        paused (st.next) but may not surface the payload, so we keep a copy on the workflow row."""
        p = self._interrupt(st)
        if p or not st.next:
            return p
        async with session_scope() as s:
            wf = await s.get(Workflow, workflow_id)
            saved = (wf.context or {}).get("pending_interrupt") if wf else None
        node = {"approval": f"gate_{saved['step']}" if saved and saved.get("type") == "approval" else None,
                "await_event": "await_work_order_close"}.get(saved.get("type")) if saved else None
        return saved if node and node in st.next else None

    async def _invoke(self, workflow_id: str, payload: Any) -> None:
        cfg = self._cfg(workflow_id)
        try:
            await (await self._graph_for(workflow_id)).ainvoke(payload, cfg)
        except Exception as e:
            log.exception("workflow %s crashed", workflow_id)
            async with session_scope() as s:
                wf = await s.get(Workflow, workflow_id)
                wf.status = "failed"
                wf.completed_at = now()
                await audit.record(s, tenant_id=wf.tenant_id, workflow_id=wf.id, record_type="workflow_status", outcome="failed",
                                   trace_id=wf.trace_id, explanation=f"Workflow stopped on an unexpected error: {type(e).__name__}: {e}")
                await self._escalate(s, wf, "system", f"Orchestration stopped on an unexpected error: {e}")
            hub.publish(wf.tenant_id, "workflow", {"id": workflow_id, "status": "failed"})
            return
        await self._after_run(workflow_id)

    async def _after_run(self, workflow_id: str) -> None:
        st = await (await self._graph_for(workflow_id)).aget_state(self._cfg(workflow_id))
        values = st.values or {}
        pending = self._interrupt(st)
        explanation = None
        if pending and pending["type"] == "approval":
            # LLM call (and its usage write) happens before we open the write transaction below.
            explanation = await self._explain(workflow_id, values, pending)
        async with session_scope() as s:
            wf = await s.get(Workflow, workflow_id)
            failure = values.get("failure")
            if failure:
                await self._escalate(s, wf, failure["step"], self._failure_text(values))
            wf.context = {**(wf.context or {}), "pending_interrupt": pending}
            if pending and pending["type"] == "approval":
                await self._create_approval(s, wf, values, pending, explanation)
                wf.status = "awaiting_approval"
                wf.current_step = pending["step"]
            elif pending and pending["type"] == "await_event":
                wf.status = "awaiting_event"
                wf.current_step = "return_to_service"
            else:
                wf.status = noshow.final_status(values) if wf.workflow_type == noshow.WORKFLOW_TYPE else self._final_status(values)
                wf.completed_at = now()
                steps = [dict(x) for x in wf.steps]
                for x in steps:
                    if x["status"] in ("pending", "waiting"):
                        x["status"] = "not_run"
                wf.steps = steps
                if wf.status == "informational" and wf.workflow_type == WORKFLOW_TYPE:
                    await self._informational_card(s, wf, values)
                await audit.record(s, tenant_id=wf.tenant_id, workflow_id=wf.id, record_type="workflow_status", outcome=wf.status,
                                   trace_id=wf.trace_id, explanation=f"Workflow finished: {wf.status.replace('_', ' ')}.")
            tenant_id, status = wf.tenant_id, wf.status
        hub.publish(tenant_id, "workflow", {"id": workflow_id, "status": status})
        await bus.publish(CloudEvent(type=EventTypes.WORKFLOW_STATUS_CHANGED, source="orchestrator", tenantid=tenant_id,
                                     correlationid=workflow_id, data={"workflow_id": workflow_id, "status": status}))

    @staticmethod
    def _final_status(values: dict) -> str:
        decisions = values.get("decisions") or {}
        f = values.get("failure")
        if any(d.get("decision") == "shadow" for d in decisions.values()) and not values.get("completed_actions"):
            return "shadow"
        if decisions.get("open_work_order", {}).get("decision") == "informational":
            return "informational"
        if decisions.get("open_work_order", {}).get("decision") == "rejected":
            return "rejected"
        if f and f["step"] == "open_work_order":
            return "failed"
        if f and not f.get("escalate_only"):
            return "compensated"
        if f or values.get("halted_at"):
            return "completed_with_issues"
        return "completed"

    @staticmethod
    def _failure_text(values: dict) -> str:
        f = values["failure"]
        comp = values.get("compensation") or []
        base = f"{f['step'].replace('_', ' ').capitalize()} failed: {f['message']}."
        if comp:
            base += " Rolled back: " + ", ".join(c["action"].replace("_", " ") for c in comp) + "."
        return base + " Check the affected runs and finish this step by hand."

    async def _escalate(self, s, wf: Workflow, step: str, text: str) -> None:
        exists = (await s.execute(select(ApprovalRequest.id).where(ApprovalRequest.workflow_id == wf.id, ApprovalRequest.step == step,
                                                                  ApprovalRequest.kind == "escalation"))).scalar_one_or_none()
        if exists:
            return
        s.add(ApprovalRequest(id=new_id("apr"), tenant_id=wf.tenant_id, workflow_id=wf.id, step=step, kind="escalation", status="pending",
                              title=f"Action needed on {wf.vehicle_label or wf.title}", summary=text, explanation=text, approver_roles=["dispatcher"],
                              vehicle_label=wf.vehicle_label, severity=wf.severity, requested_at=now()))
        await s.flush()
        hub.publish(wf.tenant_id, "approval", {"workflow_id": wf.id, "kind": "escalation"})

    async def _informational_card(self, s, wf: Workflow, values: dict) -> None:
        a = values.get("assessment", {})
        s.add(ApprovalRequest(id=new_id("apr"), tenant_id=wf.tenant_id, workflow_id=wf.id, step="open_work_order", kind="informational",
                              status="pending", title=f"For your information: {wf.vehicle_label}", summary=a.get("summary", ""),
                              explanation="Policy marks this severity as informational, so the agent recommends but does not act.",
                              recommendation={"severity": a.get("severity"), "fault": a.get("fault")}, approver_roles=["dispatcher", "shop_manager"],
                              vehicle_label=wf.vehicle_label, severity=wf.severity, requested_at=now()))
        await s.flush()

    async def _explain(self, workflow_id: str, values: dict, pending: dict):
        step = pending["step"]
        async with session_scope() as s:
            wf = await s.get(Workflow, workflow_id)
            existing = (await s.execute(select(ApprovalRequest.id).where(ApprovalRequest.workflow_id == workflow_id, ApprovalRequest.step == step,
                                                                        ApprovalRequest.kind == "approval"))).scalar_one_or_none()
            label, tenant_id = wf.vehicle_label, wf.tenant_id
        if existing:
            return None
        if values.get("workflow_type") == noshow.WORKFLOW_TYPE:
            return await llm.run("explain_step", noshow.explain_context(step, values, label), tenant_id=tenant_id, workflow_id=workflow_id)
        a = values["assessment"]
        rec = pending["recommendation"]
        explain_ctx = {"step": step, "vehicle_label": label}
        if step == "open_work_order":
            explain_ctx.update(priority=rec["priority"], title=rec["title"], window=f"{A.hm(rec['shop_start'])} to {A.hm(rec['shop_end'])}",
                               depot=rec["depot"], fault_code=rec["fault_code"], open_wos=len(a["health"]["open_work_orders"]))
        elif step == "pull_vehicle":
            explain_ctx.update(**{"from": A.hm(rec["from"]), "until": A.hm(rec["until"]), "run_count": len(rec["runs_affected"])})
        elif step == "reassign_runs":
            explain_ctx.update(proposals=rec["assignments"])
        elif step == "notify_riders":
            explain_ctx.update(run_count=len(rec["runs"]), rider_count=sum(x.get("riders", 0) for x in values.get("assignments", [])))
        elif step == "return_to_service":
            explain_ctx.update(work_order_id=rec.get("work_order_id"))
        return await llm.run("explain_step", explain_ctx, tenant_id=tenant_id, workflow_id=workflow_id)

    async def _create_approval(self, s, wf: Workflow, values: dict, pending: dict, res) -> None:
        step = pending["step"]
        existing = (await s.execute(select(ApprovalRequest).where(ApprovalRequest.workflow_id == wf.id, ApprovalRequest.step == step,
                                                                 ApprovalRequest.kind == "approval"))).scalar_one_or_none()
        if existing or res is None:
            return
        a = values["assessment"]
        rec = pending["recommendation"]
        if wf.workflow_type == noshow.WORKFLOW_TYPE:
            title = noshow.title_for(step, values)
            data_considered = noshow.data_considered(values, pending)
        else:
            title = TITLES[step].format(v=wf.vehicle_label, n=len(a["runs_at_risk"]))
            data_considered = {"severity": a["severity"], "fault": a["fault"], "health": a["health"], "timing": a["timing_reason"],
                               "runs_at_risk": len(a["runs_at_risk"]), "later_runs": len(a["later_runs"]), "policy_version": pending["policy_version"]}
        ar = ApprovalRequest(
            id=new_id("apr"), tenant_id=wf.tenant_id, workflow_id=wf.id, step=step, kind="approval", status="pending", title=title,
            summary=a["summary"], explanation=res.text, recommendation=rec, options=pending.get("options", {}), data_considered=data_considered,
            approver_roles=pending["approver_roles"], vehicle_label=wf.vehicle_label, severity=a.get("severity"), requested_at=now(),
        )
        s.add(ar)
        await s.flush()
        await audit.record(s, tenant_id=wf.tenant_id, workflow_id=wf.id, step=step, record_type="approval_requested", autonomy_level=pending["level"],
                           data_considered=data_considered, recommendation=rec, model_used=res.model, outcome="pending",
                           explanation=res.text, trace_id=wf.trace_id, triggering_event_id=wf.trigger_event_id,
                           input_tokens=res.input_tokens, output_tokens=res.output_tokens)
        hub.publish(wf.tenant_id, "approval", {"id": ar.id, "workflow_id": wf.id, "step": step})

    # ------------------------------------------------------------ queries
    async def checkpoint_state(self, workflow_id: str) -> dict:
        st = await (await self._graph_for(workflow_id)).aget_state(self._cfg(workflow_id))
        return {"next": list(st.next or []), "pending": await self._pending(workflow_id, st), "values": st.values or {}}


orchestrator = OrchestratorService()
