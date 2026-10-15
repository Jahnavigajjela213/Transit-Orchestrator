from typing import Any, Optional, TypedDict


class WorkflowState(TypedDict, total=False):
    workflow_id: str
    workflow_type: str
    tenant_id: str
    trace_id: str
    trigger_event_id: str
    trigger_type: str
    trigger: dict[str, Any]
    vehicle_id: str
    vehicle_label: str
    assessment: dict[str, Any]
    decisions: dict[str, dict[str, Any]]
    work_order: Optional[dict[str, Any]]
    block: Optional[dict[str, Any]]
    assignments: list[dict[str, Any]]
    notifications: dict[str, Any]
    completed_actions: list[dict[str, Any]]
    failure: Optional[dict[str, Any]]
    compensation: list[dict[str, Any]]
    halted_at: Optional[str]
    outcome: str
    returned: Optional[dict[str, Any]]
    defect: Optional[dict[str, Any]]
    safety_alert: Optional[str]
    coverage_gap: Optional[dict[str, Any]]  # runs the agent could not cover: raised to the dispatcher as an escalation


class NoShowState(TypedDict, total=False):
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
    adjustment: Optional[dict[str, Any]]
    notifications: dict[str, Any]
    completed_actions: list[dict[str, Any]]
    failure: Optional[dict[str, Any]]
    compensation: list[dict[str, Any]]
    recovery: dict[str, Any]
    outcome: str
