export type Role = "dispatcher" | "shop_manager" | "admin" | "viewer";

export interface User {
  id: string; email: string; full_name: string; role: Role;
  tenant_id: string; tenant_name: string; tenant_code: string;
}

export type StepStatus =
  | "pending" | "active" | "awaiting_approval" | "waiting" | "done" | "skipped"
  | "recommended" | "failed" | "compensated" | "not_run" | "shadowed" | "escalated";

export interface Step {
  key: string; label: string; description: string; status: StepStatus;
  level: string | null; detail: string; at: string | null;
}

export type WorkflowStatus =
  | "running" | "awaiting_approval" | "awaiting_event" | "completed" | "completed_with_issues"
  | "rejected" | "compensated" | "failed" | "informational" | "shadow";

export interface Workflow {
  id: string; workflow_type: string; status: WorkflowStatus; current_step: string | null;
  vehicle_id: string | null; vehicle_label: string | null; trigger_event_id: string; trigger_type: string;
  severity: string | null; title: string; summary: string; steps: Step[]; trace_id: string;
  detected_at: string; work_order_opened_at: string | null; pulled_at: string | null; returned_at: string | null;
  human_touches: number; runs_at_risk: number; runs_covered: number;
  started_at: string; updated_at: string; completed_at: string | null;
}

export interface Candidate { vehicle_id: string; label: string; vehicle_type: string; depot: string; capacity: number; score: number; reason: string; }
export interface DriverCandidate { driver_id: string; name: string; reason: string; eligible?: boolean; }

export interface Assignment {
  run_id: string; route_name: string; block_name: string; start: string; start_h: string; riders: number;
  needs_wheelchair: boolean; vehicle_id: string | null; vehicle_label: string | null; driver_id: string | null;
  driver_name: string | null; keep_driver: boolean; delay_minutes: number; reason: string;
}

export interface Approval {
  id: string; workflow_id: string; step: string; kind: "approval" | "escalation" | "informational";
  status: string; title: string; summary: string; explanation: string;
  recommendation: Record<string, any>; options: Record<string, any>; data_considered: Record<string, any>;
  approver_roles: string[]; vehicle_label: string | null; severity: string | null;
  requested_at: string; decided_at: string | null; decided_by_name: string | null; decision_note: string | null;
  override_payload: Record<string, any> | null; can_decide: boolean;
}

export interface AuditRecord {
  id: string; workflow_id: string | null; step: string | null; record_type: string; triggering_event_id: string | null;
  actor: string; actor_type: string; autonomy_level: string | null; data_considered: Record<string, any>;
  model_used: string | null; recommendation: Record<string, any>; human_action: string | null; outcome: string | null;
  explanation: string; trace_id: string | null; input_tokens: number; output_tokens: number; created_at: string;
}

export interface EventRec {
  id: string; type: string; source: string; subject: string | null; time: string; data: Record<string, any>;
  dedupe_key: string | null; status: string; error: string | null; note?: string | null; correlation_id: string | null;
  received_at: string; processed_at: string | null;
}

export interface ShadowRec {
  id: string; workflow_id: string; workflow_type: string; step: string; vehicle_label: string | null;
  recommendation: Record<string, any>; recommended_at: string; status: "open" | "matched" | "differed" | "no_action";
  human_actions: { event_id: string; type: string; step: string; by: string | null; at: string; detail: string; data: Record<string, any> }[];
  first_human_at: string | null; agreement_pct: number | null; agent_ahead_minutes: number | null;
  verdict: string | null; reviewed_by: string | null; review_note: string | null;
  workflow_title?: string; severity?: string | null; detected_at?: string;
  comparison: { item: string; agent: string; person: string; score: number | null }[];
  no_action_at: string | null;  // an open recommendation turns into "no action" at this time
}

export interface Delegation {
  step: string; agent: string; key: string; task: string; persona: string; requires: string[];
  status: "done" | "failed"; error: string | null; at: string; duration_ms: number;
}

export interface WorkflowDetail extends Workflow {
  approvals: Approval[]; audit: AuditRecord[]; notification_count: number;
  notifications: { id: string; rider_name: string; language: string; channel: string; kind: string; message: string; created_at: string }[];
  trigger_event: EventRec | null;
  context: Record<string, any>;
  checkpoint: {
    next: string[]; pending: Record<string, any> | null; work_order: Record<string, any> | null;
    assignments: any[] | null; compensation: any[] | null; failure: Record<string, any> | null; notifications: Record<string, any> | null;
    adjustment?: Record<string, any> | null; recovery?: Record<string, any> | null;
    defect?: Record<string, any> | null; safety_alert?: string | null; coverage_gap?: Record<string, any> | null;
  };
  shadow: ShadowRec[];
  work_order_status: string | null;  // live from maintenance (Postgres), not the Databricks copy
}

export interface FleetRow {
  vehicle_id: string; label: string; ids: Record<string, string | null>; vehicle_type: string; capacity: number;
  wheelchair_positions: number; depot: string; schedule_status: string; unavailable_until: string | null;
  unavailable_reason: string | null; asset_status: string; make_model: string; odometer: number; pm_miles_over: number;
  open_work_orders: { id: string; title: string; status: string; priority: string }[]; runs_today: number;
  open_defects?: { id: string; category: string; severity: string; out_of_service: boolean }[];
  telemetry: { ts: string; engine_temp_c: number; oil_pressure_kpa: number; battery_v: number; dtc_codes: string[] } | null;
  active_workflow: { id: string; status: string; current_step: string } | null;
}
