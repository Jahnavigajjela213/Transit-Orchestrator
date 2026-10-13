# Architecture

## The five layers from the proposal, as built

| Layer | Built as | Code |
|---|---|---|
| 1. Experience | React console: Needs your attention (approval surface), orchestration view with line map, agents and decision trail, assistant, dashboards, shadow-mode comparison, model evaluation | `frontend/src` |
| 2. Orchestration | LangGraph **supervisor** (one durable graph per workflow type, checkpointed in PostgreSQL) delegating to **domain agents** (asset, trip, workforce, safety, rider comms), each a LangGraph subgraph confined to its product; per-tenant **policy and autonomy engine** | `orchestrator/`, `agents/`, `policy/` |
| 3. Events and identity | CloudEvents backbone: in-process (local), Amazon EventBridge (out via PutEvents, in via rule → SQS) or Amazon MSK (Kafka topic, consumer group); de-duplication, event-time ordering, stale-signal handling; interim identity crosswalk | `core/event_bus.py`, `core/events.py`, `identity/` |
| 4. Action adapters | Typed interfaces per product; idempotency keys, retries with backoff, token-bucket rate limits, permission check, compensation; mock and HTTP implementations for FASTER, Ecolane/TripMaster, Bytecurve, **Vestige**, TripShot/Passio | `adapters/` |
| 5. Governance and data | Model router (mock / Anthropic / Bedrock / Ollama) with per-task tiers, token budgets and cost tracking; model **evaluation suite**; decision audit log with a transactional **outbox** shipped to JSONL or the Databricks Delta table; OpenTelemetry (OTLP) tracing keyed on the workflow trace id; tenant isolation; GCIP sign-in | `llm/`, `audit/`, `core/tracing.py`, `core/gcip.py` |

## Components and responsibilities

| Component | Code | Responsibility |
|---|---|---|
| Event backbone | `core/event_bus.py`, `core/events.py` | Persist every CloudEvent first (outbox), drop duplicates (same id, or same `dedupekey` within 24 h), dispatch through one worker so workflow transitions never race, replay unprocessed events on start. Product events arriving within `EVENT_REORDER_WINDOW_MS` are dispatched in **event-time order**; a late arrival is noted on the event. Trigger events older than `EVENT_MAX_AGE_HOURS`, or older than the repair of the same fault on the same vehicle, are recorded as **stale** and not acted on. |
| EventBridge / MSK | `EventBridgeEventBus`, `KafkaEventBus` | EventBridge: product events are put on the bus; with `EVENTBRIDGE_SQS_QUEUE_URL` an EventBridge rule → SQS queue is long-polled so other producers' events start and resume workflows (our own come back and are dropped by id; poison messages go to the queue's DLQ). MSK: product events are produced to `MSK_TOPIC` keyed by subject (one vehicle's events stay ordered on one partition); the orchestrator consumes as a consumer group and commits offsets only after the event is persisted (at-least-once, de-duplicated by id). SCRAM and IAM auth supported. |
| Orchestrator service | `orchestrator/service.py` | Subscribes to trigger and resume events. Starts one LangGraph thread per incident (thread id = workflow id), attaches repeat signals to the active workflow, turns graph pauses into approval cards, sets final status, raises escalations. Also feeds manual product actions to the shadow tracker. |
| Supervisor | `agents/supervisor.py` | The workflow graph is the supervisor's control flow. Inside a step it never calls a product itself: it chooses the persona the agent serves, computes effective permissions and **delegates** each product task to the owning domain agent. Every delegation (agent, task, persona, permissions needed, outcome, duration) is kept on the workflow and traced. |
| Domain agents | `agents/domain.py` | Asset, Trip, Workforce, Safety, Rider comms. Each is a LangGraph subgraph `check → act → report`. `check` narrows the action context to the agent's own product and verifies the persona holds every permission the task needs, so a task fails before any partial write; an agent physically cannot write to another product. |
| Workflow graphs | `orchestrator/graph.py`, `orchestrator/noshow.py` | Vehicle health (seven steps) and No-show recovery (five steps) as gate/exec node pairs, compensation, rejection handling, waiting for the shop, shadow branch. |
| Assessment | `orchestrator/assessment.py` | Severity, shop window, runs at risk, spare vehicle and driver candidates under hard constraints (licence, air brakes, wheelchair securement, capacity, wheelchair positions, double booking, driver hours, **Vestige compliance**), rider message templates. |
| Policy engine | `policy/engine.py`, `policy/defaults.py` | Per tenant and workflow: run mode (`live`/`shadow`), per-step level (`informational`, `shadow`, `semi_autonomous`, `autonomous`) with per-severity overrides, approver roles, the persona each step `acts_as`, thresholds, compensation rules, Vestige rules, agent permissions and **persona permissions**. Versioned; every change audited. |
| Shadow tracker | `orchestrator/shadow.py` | Records shadow recommendations; matches manual product actions (work orders, pulls, reassignments, rider messages, defects) to them with an agreement score and how much earlier the agent was ready; counts manual re-entry per incident; measures the Phase 0 baseline. |
| Adapters | `adapters/*` | Typed interfaces; every write goes through `protected_write` (permission check, idempotency record, token-bucket rate limit, retry with exponential backoff on transient errors). |
| Identity | `identity/service.py` | Canonical ↔ product ID mapping (interim crosswalk) for asset management, trip management, workforce, telematics and safety. |
| LLM router + evals | `llm/router.py`, `llm/providers.py`, `llm/evals.py` | Task → model tier routing, daily token budget per tenant, usage and cost tracking, automatic fallback to the deterministic provider. The evaluation suite scores any provider on the orchestrator's real tasks before a model swap. |
| Audit | `audit/service.py`, `audit/shipper.py`, `audit/sinks.py` | Decision records (Delta-shaped) in the orchestrator database; an outbox row written in the same transaction is shipped in batches to JSONL or Databricks (MERGE on id) with retries and backoff; delivery status on the Overview. |
| Tracing | `core/tracing.py` | OpenTelemetry spans for workflow start/resume, every agent delegation and every adapter call, all parented on the workflow's `trace_id` (the id in every audit record); OTLP/HTTP export; FastAPI request spans. |
| Sign-in | `core/gcip.py`, `api/routes/auth.py`, `api/deps.py` | `AUTH_MODE=local` (demo JWT) or `gcip`: Identity Platform ID tokens verified (RS256 against Google's keys, audience, issuer, expiry), GCIP tenants mapped to agencies, users matched by verified email (or provisioned from the `role` claim), exchanged for an app session. |
| Real-time | `core/realtime.py`, `api/routes/stream.py` | Server-Sent Events per tenant; the UI refetches when something changes. |
| Performance analytics | `analytics/*` | Feature pipeline, model training and registry, insights, model-scored levers and plans, grounded Q&A, fine-tuning export. |
| Scenario replay | `simulator/replay.py` | Built-in scenarios (peak brake fault with repeat, fault storm, late / out-of-order / stale signals, no-show cluster) and replay of exported CloudEvents files, all through the real backbone. |
| Synthetic products | `products/*` | Own tables and own IDs; publish events after their transaction commits (`product_session`); manual actions carry `manual: true` and who did it; simulated outages. |

## Domain agents and personas

```
                       ┌──────────── Supervisor (workflow graph) ────────────┐
 step decided by a     │ persona = approver's role, or policy acts_as        │
 person or by policy → │ effective = agent_permissions ∩ persona_permissions │
                       └───┬──────────┬──────────┬──────────┬──────────┬─────┘
                           ▼          ▼          ▼          ▼          ▼
                      Asset agent  Trip agent  Workforce  Safety     Rider comms
                      (FASTER)     (Ecolane)   (Bytecurve)(Vestige)  (TripShot)
                      check→act→report: only its own product's actions, only what the persona may do
```

| Step | Agents |
|---|---|
| Assess | asset (fault, health, shop window), trip (runs at risk, spares, cover plan), workforce (roster), safety (driver compliance, open defects) |
| Open work order | asset (work order), safety (vehicle defect for brake/accessibility/critical faults) |
| Pull vehicle / Reassign runs | trip |
| Notify riders | trip (ETAs), rider comms (messages) |
| Return to service | asset (work order closed?), trip (back on schedule), safety (clear the defect) |

Default persona permissions: dispatcher (trip actions, rider messages, open work orders and defects), shop manager
(work orders incl. cancel, return to service, defects incl. clearing), admin (everything), viewer (nothing). A step
approved by a dispatcher runs with dispatcher permissions; a step the agent takes on its own runs as the step's
`acts_as` persona; compensation runs as the step's `acts_as` persona.

## Event catalog

| Type | Source | Effect |
|---|---|---|
| `vehicle.fault.detected` | telematics | Starts a vehicle_health workflow (or attaches to the active one) |
| `vehicle.pm.overdue` | asset_mgmt | Same |
| `workorder.closed` / `workorder.cancelled` | asset_mgmt | Resumes a workflow waiting for the shop |
| `orchestrator.approval.decided` | orchestrator | Resumes a paused gate with the person's decision |
| `trip.no_show`, `trip.cancelled` | trip_mgmt | Starts a no_show_recovery workflow |
| `workorder.created`, `vehicle.availability.changed`, `run.reassigned`, `rider.notified`, `safety.defect.opened` | products | Informational; when `manual` they feed shadow comparison and manual re-entry |
| `safety.defect.closed`, `safety.driver.compliance_changed`, `trip.booked`, `orchestrator.workflow.status_changed` | products / orchestrator | Informational, visible in the event stream |

Envelope (`CloudEvent`): `id, specversion, type, source, subject (canonical id), time, tenantid, data, dedupekey, correlationid, traceid`.
Event statuses: `received`, `processed`, `duplicate`, `stale`, `ignored`, `failed`.

## Workflow graph (vehicle health)

```
START → assess → gate_open_work_order ─approve/auto→ exec_open_work_order ─ok→ gate_pull_vehicle
                        │ shadow → gate_pull_vehicle                 └fail→ compensate
                        │ reject / informational → finish
gate_pull_vehicle ─go→ exec_pull_vehicle ─ok→ gate_reassign_runs
        │ shadow → gate_reassign_runs │ reject → await_work_order_close      └fail→ compensate
gate_reassign_runs ─go→ exec_reassign_runs ─ok→ gate_notify_riders
        │ shadow → gate_notify_riders │ reject → restore_after_reject → await_work_order_close
        │ skipped (no runs / no spare) → gate_notify_riders
gate_notify_riders ─go→ exec_notify_riders → await_work_order_close
await_work_order_close (interrupt until workorder.closed) → gate_return_to_service → exec_return_to_service → finish
compensate → await_work_order_close (work order kept) | finish
```

Final statuses: `completed`, `completed_with_issues`, `compensated`, `rejected`, `failed`, `informational`, `shadow`.

## Why side effects sit where they do

LangGraph re-runs a node from its start when resuming after `interrupt()`. Therefore:
* gate nodes only read policy and write idempotent step status (and, in shadow, an idempotent recommendation) before pausing;
* approval cards and the LLM explanation for them are created once by `OrchestratorService` after the graph pauses (unique constraint);
* every product write carries an idempotency key derived from the workflow id and step;
* domain-agent subgraphs run inside one parent step with checkpointing disabled, so a resumed step simply re-delegates (idempotent).

The pending pause payload is also saved on the workflow row, because after a process restart the checkpoint reliably
reports *which* node is paused but not always its payload.

## Data model (main tables)

Platform: `tenants, users, policies, events, workflows, approval_requests, audit_records, audit_outbox, idempotency_records,
llm_usage, eval_runs, shadow_recommendations, tenant_baselines, fault_injections, canonical_entities, identity_crosswalk`.
Products: `am_` (asset), `tm_` (trip, incl. `tm_trip_requests`, `tm_no_show_log`), `wf_` (workforce), `rc_` (rider comms),
`tl_` (telematics), `sf_` (safety: `sf_drivers`, `sf_defects`). Analytics: `an_run_history`, `an_models`.
LangGraph checkpoints: `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`.

## REST API (see /docs for schemas)

| Area | Endpoints |
|---|---|
| Auth | `GET /api/auth/config`, `POST /api/auth/login` (local), `POST /api/auth/gcip` (Identity Platform), `GET /api/auth/me`, `GET /api/auth/demo-accounts` |
| Needs your attention | `GET /api/approvals`, `GET /api/approvals/{id}`, `POST /api/approvals/{id}/decision` |
| Orchestrations | `GET /api/workflows`, `GET /api/workflows/{id}` (incl. agent plan, delegations, defect, shadow, manual entries) |
| Unified views | `GET /api/fleet`, `GET /api/schedule` |
| Governance | `GET /api/audit`, `GET /api/audit/export`, `GET /api/audit/mirror/status`, `POST /api/audit/mirror/retry`, `GET/PUT /api/policies/{type}`, `GET /api/metrics/summary`, `GET/PUT /api/metrics/baseline`, `POST /api/metrics/baseline/measure` |
| Shadow mode | `GET /api/shadow`, `GET /api/shadow/summary`, `POST /api/shadow/{id}/review` |
| Model evaluation | `GET /api/evals`, `GET /api/evals/{id}`, `POST /api/evals/run` |
| Events | `GET /api/events`, `GET /api/events/catalog`, `GET /api/events/export`, `POST /api/events/ingest` |
| Assistant / Performance | `POST /api/assistant/ask`, `/api/performance/*` |
| Simulator | fault, pm-overdue, duplicate, no-show, pm-scan, failures, stream, `GET /api/simulator/scenarios`, `POST /api/simulator/scenarios/run`, `POST /api/simulator/replay`, `POST /api/simulator/driver-compliance` |
| Admin / system | `POST /api/admin/reset`, `GET /api/system/info`, `GET /api/agents`, `GET /api/health`, `GET /api/stream?token=` (SSE) |
| Synthetic products | `/products/asset-mgmt/*`, `/products/trip-mgmt/*` (incl. manual block/release/assign), `/products/workforce/*`, `/products/rider-comms/*` (incl. manual send), `/products/telematics/*`, `/products/safety/*` |

## Roles

| Role | Can |
|---|---|
| Dispatcher | Decide steps where policy names dispatcher, act by hand in trip management and rider comms, review shadow results, run simulations |
| Shop manager | Approve work orders, start/close work orders, clear Vestige defects |
| Operations admin | Everything, including policy, baseline, model evaluation runs and data reset |
| Analyst | Read-only |
