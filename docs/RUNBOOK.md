# Operations runbook

For whoever runs the orchestrator day to day (Transit Technologies engineering after handover). Every check below
has a screen in the console and an API call, so it can be scripted into monitoring.

## 1. Start, stop, health

| Task | How |
|---|---|
| Start | `backend/`: `python run.py` (port 8000). `frontend/`: `npm run dev` (5173), or serve `npm run build` output behind the same origin as `/api`. |
| Health | `GET /api/health` → `{"status":"ok"}`. Use it for the load balancer. |
| What is configured | `GET /api/system/info` (event bus, LLM/SLM provider, adapters, audit mirror, tracing exporter, auth mode, agents). |
| Stop safely | Ctrl+C / SIGTERM. In-flight graph steps finish or are retried on start: graph state is checkpointed per step, unprocessed events are replayed, the audit outbox is flushed. Paused workflows (approvals, "in the shop") resume exactly where they were. |
| Multiple instances | Only after the event backbone is EventBridge→SQS or MSK with one consumer per partition (see REAL_INTEGRATION.md §4). The in-memory bus is single-instance. |

## 2. Daily checks (Overview screen)

| Signal | Where | Healthy | If not |
|---|---|---|---|
| Items waiting for people | Needs your attention, header badge | Drains during the shift | Check approver roles in the policy; check the dispatcher is signed in. |
| Escalations ("Action needed") | Needs your attention, red items | Rare, each acknowledged | Read the card; it says what failed and what was rolled back. Finish the step by hand in the product, then acknowledge. |
| Workflows stuck | `GET /api/workflows?status=running` older than a few minutes | None | See §4 "Stuck workflow". |
| Event failures | Event stream, status `failed` | None | Open the event, read `error`. Fix the cause, then replay it (§5). |
| Stale events | Event stream, status `stale` | Only from patchy vehicles | Expected for buffered signals; if many, check device clocks and `EVENT_MAX_AGE_HOURS`. |
| Audit delivery | Overview → Audit log delivery; `GET /api/audit/mirror/status` | `pending` near 0, `failed` 0, `lag_seconds` < 60 | §4 "Audit mirror". |
| Model fallbacks / budget | Overview → Model usage (fallback count) | 0 fallbacks | Check provider keys, quotas and `LLM_DAILY_TOKEN_BUDGET`. Workflows keep running on the deterministic provider. |
| Dispatcher acceptance | Overview → acceptance, weekly trend, "Ready for more autonomy?" | Rising | Review rejected/changed decisions in the audit log; tune thresholds or prompts. |

## 3. Policy changes

* Only operations admins can change policy (`PUT /api/policies/{type}`); every change creates a new version and an audit record (`policy_change`, before/after).
* Order of rollout per customer: **Shadow → Needs approval → Agent acts**, step by step, using the Shadow mode screen and the "Ready for more autonomy?" panel as evidence.
* Removing an agent or persona permission makes the affected step fail safely, roll back and escalate. Use it as a kill switch for one action (e.g. stop the agent pulling vehicles) without a deploy.
* Kill switch for everything: set the workflow's run mode to **Shadow**. The agent keeps recommending, never acts.

## 4. Incidents

**Product API down / failing.** Symptoms: escalations "Action needed", `action_failed` in the decision trail, retries in logs.
Transient errors (429, 5xx, timeouts) are retried with backoff (`ADAPTER_MAX_RETRIES`). Permanent errors roll back earlier
steps per the compensation policy and escalate. Nothing to do on the orchestrator; fix the product, then finish the escalated
steps by hand. To rehearse: Simulator → Simulate a product outage.

**Stuck workflow** (status `running` for minutes). Look at `GET /api/workflows/{id}` → `checkpoint.next`. If empty and status
`running`, the process died mid-step: restart the backend; the event that drove it is replayed. If it keeps failing, the workflow
is marked `failed` with an escalation explaining the error; finish by hand.

**Audit mirror (Databricks) down.** `GET /api/audit/mirror/status` shows `pending` growing and `last_error`. Records are safe in the
orchestrator database. Batches are retried with backoff up to 12 times, then marked `failed`. After fixing Databricks:
`POST /api/audit/mirror/retry` (Overview → Retry failed). Delivery is idempotent (MERGE on id).

**Duplicate or out-of-order signals from vehicles.** Expected. Duplicates (same id or dedupe key within 24 h) are dropped; signals in
a short burst are handled in the order they happened; a buffered copy of a fault that was already repaired is `stale`. Tune
`EVENT_REORDER_WINDOW_MS` and `EVENT_MAX_AGE_HOURS` if a fleet's connectivity is very poor.

**Wrong or unexpected agent recommendation.** Open the orchestration: Assessment, Agents (which agent did what, for which persona),
Decision trail (data considered, model used, recommendation, human action, outcome). Ask the assistant "why…". Use the trace id
in your tracing backend to see every product call. If a model is at fault, run the evaluation suite against it (§6).

**Driver proposed who should not drive.** The safety agent excludes drivers Vestige marks non-compliant. Check the driver's record
on Safety & compliance and the policy's Vestige section (`exclude_noncompliant_drivers`). If Vestige is down, the step fails and
escalates rather than proposing unchecked drivers.

## 5. Replaying events

* Export: `GET /api/events/export?since_hours=24&type=vehicle.fault.detected` (JSON Lines CloudEvents) or Event stream → Export.
* Replay: Simulator → Replay an event file, or `POST /api/simulator/replay {"events": [...], "shift_to_now": true, "keep_dedupe": false}`.
  Replayed events get new ids; with `keep_dedupe` they are dropped as duplicates inside the 24 h window (useful to prove idempotency).
* Scenario regression before a release: Simulator → Scenario testing (all four), then check the event statuses and the orchestrations.

## 6. Changing or upgrading a model

1. Configure the candidate in `backend/.env` (e.g. new `ANTHROPIC_MODEL_FAST`, or `BEDROCK_MODEL_*`).
2. Model evaluation → Run evaluation (or `python scripts/run_evals.py --provider bedrock`; exits non-zero on failure for CI).
3. Compare with the previous run: score, failed checks (JSON, candidate constraint, injection, length, facts), latency p50/p95, cost.
4. Switch `LLM_PROVIDER` only if it passes; keep the previous run as the record. Watch Overview → Model usage for fallbacks the first day.

## 7. Data and environments

* Reset demo data: Simulator → Reset demo data (admin) or stop the backend and `python scripts/reset_data.py`.
* Back up: standard PostgreSQL backups cover app data, audit and LangGraph checkpoints (same database).
* Schema changes: new tables are created on start; columns added after release are added in place (`core/database.py:ADDED_COLUMNS`). Use Alembic for production migrations.
* Tests: `cd backend && pytest -q` (recreates `transit_orchestrator_test` with the credentials in `backend/.env`).

## 8. Escalation contacts (fill in at handover)

| Area | Owner | Channel |
|---|---|---|
| Orchestrator service | | |
| Product APIs (FASTER, Ecolane/TripMaster, Bytecurve, Vestige, TripShot/Passio) | | |
| AWS (EventBridge/MSK, Bedrock) | | |
| Databricks (audit Delta table, feature pipelines) | | |
| Identity (GCIP) | | |
