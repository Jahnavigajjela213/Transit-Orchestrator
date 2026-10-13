# Replacing synthetic parts with real systems

Do these one at a time; the system keeps working after each step because every piece sits behind an interface.

## 0. No-Show Recovery on real trip management
Real products must publish `trip.no_show` / `trip.cancelled` (data: `trip_id`, `run_id`, `rider_id`, `kind`) and the HTTP
trip adapter must implement `get_trip`, `run_detail`, `waitlist_candidates`, `book_request`, `cancel_booking`,
`rider_no_show_count` (templates in `adapters/http.py`). Replace the synthetic detour estimate in
`orchestrator/noshow.py::_detour_minutes` with your routing engine.

## 1. Identity (do first)
`backend/app/identity/service.py` maps canonical IDs to product IDs. Today it reads the `identity_crosswalk`
table filled by the seed. Options:
* Load real crosswalk rows (vehicle, driver, trip) from each product's master data into the same table, or
* Replace the method bodies with calls to the shared identity layer. Callers do not change.

## 2. Products publish events
Have each product (or an EventBridge rule with an API destination) POST CloudEvents to
`POST /api/events/ingest` with header `X-Ingest-Key: <INGEST_API_KEY>`:
```json
{"type": "vehicle.fault.detected", "source": "telematics", "tenantid": "ten_mvt",
 "subject": "veh_mvt_105", "data": {"device_id": "TLM-88A1", "fault_code": "P0217", "description": "Engine coolant over-temperature"},
 "dedupekey": "dtc:TLM-88A1:P0217:2026101014"}
```
If `subject` is missing the orchestrator resolves the vehicle from `device_id` or `asset_number`.
`workorder.closed` must carry `work_order_id` (and ideally `external_ref` = the workflow id we sent when creating it).

## 3. Product adapters
1. Set `ADAPTER_MODE=http` and each `*_API_BASE_URL` / `*_API_KEY` in `backend/.env`.
2. In `backend/app/adapters/http.py`, align each method's path, payload and response mapping with the
   vendor API. Every method must return the same dict keys as the mock adapter in `adapters/mock.py`
   (they are what the graph stores in state).
3. Keep sending the `Idempotency-Key` header; if a vendor lacks idempotency, keep `protected_write` (it
   records results locally) and add a lookup-before-create in the adapter.
4. Mark 429/5xx/timeouts as transient (already done) so they are retried.
5. Run the pytest suite with `ADAPTER_MODE=mock` (unit) and a smoke scenario against staging.

Missing write operations or events are Phase 0 findings: use change data capture or ask the product team for
a scoped API addition, as the proposal notes.

## 4. Event backbone
Install `requirements-optional.txt` and configure AWS credentials.

**Amazon EventBridge** (`EVENT_BUS=eventbridge`, `EVENTBRIDGE_BUS_NAME`):
* Outbound: every product event is put on the bus (`Source=transittech.<product>`, `DetailType=<type>`, `Detail=<CloudEvent>`).
* Inbound: create an EventBridge rule on the bus (e.g. `{"source": [{"prefix": "transittech."}]}`) targeting an SQS queue with a
  redrive policy (DLQ), and set `EVENTBRIDGE_SQS_QUEUE_URL`. The orchestrator long-polls the queue; events other producers put on
  the bus start and resume workflows. Its own events come back too and are dropped as duplicates by id. Use a FIFO queue with
  `MessageGroupId = subject` if you need strict per-vehicle ordering across instances.

**Amazon MSK / Kafka** (`EVENT_BUS=msk`): `MSK_BOOTSTRAP_SERVERS`, `MSK_TOPIC`, `MSK_CONSUMER_GROUP`, and
`MSK_SECURITY_PROTOCOL=SASL_SSL` with `MSK_SASL_MECHANISM=SCRAM-SHA-512` (+ `MSK_USERNAME`/`MSK_PASSWORD`) or
`AWS_MSK_IAM` (IAM role of the task). Events are keyed by subject, so one vehicle's events stay ordered on one partition;
offsets are committed after the event is persisted (at-least-once + de-duplication by id).

In both modes events are still persisted and processed through the same de-duplication, event-time ordering and stale rules.
Run several backend instances only with one of these backbones.

## 5. LLM
* Anthropic API: `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, model names.
* Amazon Bedrock: `LLM_PROVIDER=bedrock`, `AWS_REGION`, `BEDROCK_MODEL_FAST`, `BEDROCK_MODEL_SMART` (your model IDs), AWS credentials.
* `LLM_DAILY_TOKEN_BUDGET` caps spend per tenant; beyond it, and on any model error, the deterministic provider answers so workflows never stall.
* The model never bypasses hard constraints: it can only reorder candidates that passed the checks in `assessment.py`.

## 6. Audit to Databricks
`AUDIT_MIRROR=databricks` with `DATABRICKS_HOST`, `DATABRICKS_HTTP_PATH`, `DATABRICKS_TOKEN`, `DATABRICKS_AUDIT_TABLE`.
The Delta table is created on first write (`DatabricksMirror.DDL`, partitioned by tenant). Every audit record is queued in an
outbox in the same transaction and shipped in batches (`AUDIT_SHIP_INTERVAL_SECONDS`, `AUDIT_SHIP_BATCH_SIZE`) with a MERGE on
id, retried with backoff while Databricks is unavailable; status at `GET /api/audit/mirror/status`. Alternatively keep
`AUDIT_MIRROR=jsonl` and ingest the file with Auto Loader.

## 7. Database and checkpoints
Already PostgreSQL: app tables and LangGraph checkpoints (`AsyncPostgresSaver`) share `DATABASE_URL`. For production
point it at RDS/Aurora, run several backend instances only after moving the bus to SQS (one consumer per vehicle/trip
partition), and move timestamps to timezone-aware UTC.

## 10. Operator Performance SLM on real data
1. Schedule a Databricks job that writes one row per run per day with the columns of `an_run_history`
   (see `models/analytics.py`), and sync it to the app database (or point `analytics/model.load_history` at Databricks SQL).
2. Click *Retrain model* (or call `POST /api/performance/train`); check holdout metrics and top factors on the Performance page.
3. Tune the levers in `analytics/insights.py` to your agency's real options and costs.
4. To fine-tune a small model: download *Fine-tuning data* (chat JSONL), train in Databricks (e.g. a 1-8B model with LoRA),
   serve it (Model Serving, Bedrock custom model or Ollama), and set `SLM_PROVIDER` accordingly. Keep the grounding step:
   the model should phrase answers, the statistical model should produce the numbers.

## 8. Sign-in (GCIP)
Set `AUTH_MODE=gcip`, `GCIP_PROJECT_ID`, `GCIP_API_KEY` (Web API key), and for multi-tenant Identity Platform
`GCIP_TENANT_MAP=<gcip tenant id>:<agency id>,...`. The sign-in screen authenticates against Identity Platform's REST API and the
backend verifies the ID token (RS256 against Google's keys, audience, issuer, expiry), checks the email is verified and the tenant
is mapped, matches the user by email (or creates one from the `role` custom claim when `GCIP_AUTO_PROVISION=true`) and issues an
app session. API clients may send a GCIP ID token directly as the Bearer token. Password sign-in is turned off in this mode, and
`/api/auth/demo-accounts` is already disabled when `ENVIRONMENT` is not `local`.

## 9. Tracing
`OTEL_ENABLED=true`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://<collector>:4318` (Jaeger, Grafana Tempo, AWS ADOT → X-Ray),
`OTEL_SERVICE_NAME`. Spans cover workflow start/resume, every agent delegation (agent, task, persona) and every product call,
all on the workflow's `trace_id`, which is also on every audit record, so an audit entry links straight to its trace. API
requests are traced when `opentelemetry-instrumentation-fastapi` is installed.

## 11. Safety & compliance (Vestige)
`SAFETY_API_BASE_URL` / `SAFETY_API_KEY` and align `HttpSafetyAdapter` (`adapters/http.py`) with the Vestige API: driver
compliance by id and date, open defects for a vehicle, open and clear a defect. Load driver and vehicle Vestige ids into the
crosswalk (`system = "safety"`). Which faults also become a Vestige defect, and whether non-compliant drivers are excluded, is
per-tenant policy (Autonomy policy → Safety & compliance).

## 12. Rolling out: shadow mode first
For a design partner, set the workflow's run mode to **Shadow**. The agent records what it would do; dispatchers and the shop
work in the products as today; manual actions are matched to the agent's recommendations (Shadow mode screen), counted as
manual re-entry, and used to **measure the Phase 0 baseline** (`POST /api/metrics/baseline/measure`). Move steps to "Needs
approval" when their agreement is high, then to "Agent acts" when "Ready for more autonomy?" says so.

## 13. Changing the model
Run the evaluation suite against the candidate (Model evaluation screen or `python scripts/run_evals.py --provider bedrock`)
and switch only when it passes. See RUNBOOK.md §6.
