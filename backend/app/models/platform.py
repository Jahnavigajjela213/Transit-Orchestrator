"""Orchestration-platform tables: tenants, users, policies, events, workflows, approvals, audit."""
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.clock import now
from app.core.database import Base


class Tenant(Base):
    __tablename__ = "tenants"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    timezone: Mapped[str] = mapped_column(String(60), default="America/Los_Angeles")
    agent_persona: Mapped[str] = mapped_column(String(60), default="orchestrator-agent")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    email: Mapped[str] = mapped_column(String(160), unique=True)
    full_name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(30))  # dispatcher | shop_manager | admin | viewer
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Policy(Base):
    """Per-tenant autonomy rules for one workflow type. Policy over code."""

    __tablename__ = "policies"
    __table_args__ = (UniqueConstraint("tenant_id", "workflow_type"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    workflow_type: Mapped[str] = mapped_column(String(60))
    version: Mapped[int] = mapped_column(Integer, default=1)
    rules: Mapped[dict] = mapped_column(JSON)
    updated_by: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class EventRecord(Base):
    """Every event that touched the backbone, in CloudEvents shape."""

    __tablename__ = "events"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    type: Mapped[str] = mapped_column(String(80), index=True)
    source: Mapped[str] = mapped_column(String(80))
    subject: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    time: Mapped[datetime] = mapped_column(DateTime)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    dedupe_key: Mapped[Optional[str]] = mapped_column(String(160), index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="received")  # received|processed|duplicate|failed|ignored|stale
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # e.g. arrived late, handled in event-time order
    correlation_id: Mapped[Optional[str]] = mapped_column(String(40), index=True, nullable=True)
    trace_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class Workflow(Base):
    __tablename__ = "workflows"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    workflow_type: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(30), index=True)
    # running | awaiting_approval | awaiting_event | completed | rejected | compensated | failed | informational
    current_step: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    vehicle_id: Mapped[Optional[str]] = mapped_column(String(40), index=True, nullable=True)
    vehicle_label: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    trigger_event_id: Mapped[str] = mapped_column(String(64))
    trigger_type: Mapped[str] = mapped_column(String(80))
    severity: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    steps: Mapped[list] = mapped_column(JSON, default=list)
    context: Mapped[dict] = mapped_column(JSON, default=dict)
    trace_id: Mapped[str] = mapped_column(String(40))
    detected_at: Mapped[datetime] = mapped_column(DateTime)
    work_order_opened_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    pulled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    returned_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    human_touches: Mapped[int] = mapped_column(Integer, default=0)
    runs_at_risk: Mapped[int] = mapped_column(Integer, default=0)
    runs_covered: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class ApprovalRequest(Base):
    """An item in the Needs Your Attention panel."""

    __tablename__ = "approval_requests"
    __table_args__ = (UniqueConstraint("workflow_id", "step", "kind"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    workflow_id: Mapped[str] = mapped_column(ForeignKey("workflows.id"), index=True)
    step: Mapped[str] = mapped_column(String(40))
    kind: Mapped[str] = mapped_column(String(20), default="approval")  # approval | escalation | informational
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    # pending | approved | rejected | overridden | acknowledged | cancelled
    title: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(Text, default="")
    explanation: Mapped[str] = mapped_column(Text, default="")
    recommendation: Mapped[dict] = mapped_column(JSON, default=dict)
    options: Mapped[dict] = mapped_column(JSON, default=dict)
    data_considered: Mapped[dict] = mapped_column(JSON, default=dict)
    approver_roles: Mapped[list] = mapped_column(JSON, default=list)
    vehicle_label: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    severity: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    decided_by: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    decided_by_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    decision_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    override_payload: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)


class AuditRecord(Base):
    """Decision audit log. Mirrors the Delta table schema planned for Databricks."""

    __tablename__ = "audit_records"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    workflow_id: Mapped[Optional[str]] = mapped_column(String(40), index=True, nullable=True)
    step: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    record_type: Mapped[str] = mapped_column(String(40), index=True)
    # event_received | assessment | decision | approval_requested | human_action | action_executed
    # action_failed | compensation | workflow_status | assistant_answer | policy_change
    triggering_event_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    actor: Mapped[str] = mapped_column(String(120), default="system")
    actor_type: Mapped[str] = mapped_column(String(20), default="agent")  # agent | human | system | product
    autonomy_level: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    data_considered: Mapped[dict] = mapped_column(JSON, default=dict)
    model_used: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    recommendation: Mapped[dict] = mapped_column(JSON, default=dict)
    human_action: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    outcome: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    explanation: Mapped[str] = mapped_column(Text, default="")
    trace_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"
    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(40))
    action: Mapped[str] = mapped_column(String(80))
    result: Mapped[Any] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class LLMUsage(Base):
    __tablename__ = "llm_usage"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    workflow_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    task: Mapped[str] = mapped_column(String(40))
    provider: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(80))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    fallback: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class FaultInjection(Base):
    """Simulator switch that makes a mock product action fail (to test compensation)."""

    __tablename__ = "fault_injections"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    target: Mapped[str] = mapped_column(String(80))  # e.g. trip_mgmt.assign_run
    mode: Mapped[str] = mapped_column(String(20))  # fail_once (transient, retried) | fail_always
    remaining: Mapped[int] = mapped_column(Integer, default=1)
    message: Mapped[str] = mapped_column(String(200), default="Injected failure")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class ShadowRecommendation(Base):
    """What the agent would have done in shadow mode, and what people actually did in the products."""

    __tablename__ = "shadow_recommendations"
    __table_args__ = (UniqueConstraint("workflow_id", "step"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    workflow_id: Mapped[str] = mapped_column(String(40), index=True)
    workflow_type: Mapped[str] = mapped_column(String(60))
    step: Mapped[str] = mapped_column(String(40))
    vehicle_id: Mapped[Optional[str]] = mapped_column(String(40), index=True, nullable=True)
    vehicle_label: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    recommendation: Mapped[dict] = mapped_column(JSON, default=dict)
    recommended_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)  # open | matched | differed | no_action
    human_actions: Mapped[list] = mapped_column(JSON, default=list)  # product actions people took for this step
    first_human_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    agreement_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    verdict: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # agent_better | human_better | same (reviewer)
    reviewed_by: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    review_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class TenantBaseline(Base):
    """Phase 0 baseline for the success measures, per tenant: typed in, or measured from shadow mode."""

    __tablename__ = "tenant_baselines"
    tenant_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    values: Mapped[dict] = mapped_column(JSON, default=dict)
    source: Mapped[str] = mapped_column(String(40), default="default")  # default | entered | measured_shadow
    notes: Mapped[str] = mapped_column(Text, default="")
    updated_by: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class AuditOutbox(Base):
    """Audit records waiting to be shipped to the mirror (JSONL / Databricks Delta). Written in the same
    transaction as the audit record, so nothing is lost if the mirror is down; shipped with retries."""

    __tablename__ = "audit_outbox"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)  # same id as the audit record
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending | sent | failed
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class EvalRun(Base):
    """One run of the model evaluation suite against a provider/model, used to decide model swaps."""

    __tablename__ = "eval_runs"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    provider: Mapped[str] = mapped_column(String(20))
    model_fast: Mapped[str] = mapped_column(String(120), default="")
    model_smart: Mapped[str] = mapped_column(String(120), default="")
    started_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="running")  # running | passed | failed | error
    score_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pass_threshold_pct: Mapped[float] = mapped_column(Float, default=90.0)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    cases: Mapped[list] = mapped_column(JSON, default=list)
    run_by: Mapped[str] = mapped_column(String(120), default="system")


class DatabricksSyncOutbox(Base):
    """Changed product rows waiting to be copied to Databricks. Filled by Postgres triggers (app/sync/databricks.py)."""

    __tablename__ = "databricks_sync_outbox"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    table_name: Mapped[str] = mapped_column(String(60))
    pk: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class DatabricksSyncState(Base):
    """When each table was last fully copied to Databricks. No row means a full copy is due (e.g. after a reset)."""

    __tablename__ = "databricks_sync_state"
    table_name: Mapped[str] = mapped_column(String(60), primary_key=True)
    rows: Mapped[int] = mapped_column(Integer, default=0)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class AuditEmbedding(Base):
    """Sentence embedding of one audit record's text (all-MiniLM-L6-v2), for semantic search by the assistant."""

    __tablename__ = "audit_embeddings"
    audit_id: Mapped[str] = mapped_column(String(40), primary_key=True)  # = audit_records.id
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    workflow_id: Mapped[Optional[str]] = mapped_column(String(40), index=True, nullable=True)
    record_type: Mapped[str] = mapped_column(String(40))
    text: Mapped[str] = mapped_column(Text)  # what was embedded
    model: Mapped[str] = mapped_column(String(120))
    dims: Mapped[int] = mapped_column(Integer)
    embedding: Mapped[list] = mapped_column(JSON)  # normalized vector, so cosine similarity = dot product
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
