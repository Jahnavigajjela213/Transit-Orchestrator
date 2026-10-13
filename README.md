# TransitTechOS Agentic Cross-Product Orchestration

A complete, locally runnable build of the Brightcone proposal for Transit Technologies, covering all three use cases:

1. **Vehicle Health → Service Continuity** (the pilot). A fault on one vehicle becomes a coordinated, policy-governed,
   fully audited response across asset management, trip management, workforce, safety & compliance and rider communications.
2. **No-Show Recovery Agent** (Phase 2). When a rider no-shows or cancels late, the agent books a waiting standby
   rider into the freed seat, or moves later pickups earlier when the run is behind, notifies riders and flags repeat no-shows.
3. **Operator Performance SLM** (Phase 3). A per-agency model trained on 120 days of run history explains what drives
   late pickups and answers questions such as "how do we move OTP from 92% to 95%?" with a ranked, model-scored plan.

Everything runs on your laptop with a local **PostgreSQL**. No Docker, no cloud account, no API keys. All product
systems and history are synthetic and generated on first start; each product sits behind an adapter interface so it
can be replaced by the real API later without touching the orchestrator.

| Layer (from the proposal) | This build | Swap to production by |
|---|---|---|
| Experience: TransitTechOS UI, Needs Your Attention panel | React + TypeScript + Tailwind console | Embed the screens/components into TransitTechOS |
| Orchestration: LangGraph supervisor, domain agents, durable state, policy engine | LangGraph supervisor graphs (PostgreSQL checkpointer) delegating every product task to five domain agents (asset, trip, workforce, safety, rider comms), each a subgraph confined to its product; per-tenant policy with live/shadow mode and persona-bound permissions | Point `DATABASE_URL` at your managed Postgres |
| Events and identity: EventBridge/MSK, CloudEvents, shared IDs | CloudEvents backbone (in-process, EventBridge in+out via SQS, or MSK/Kafka) with de-duplication, event-time ordering and stale-signal handling; identity crosswalk | `EVENT_BUS=eventbridge` or `msk`, replace `IdentityService` |
| Action adapters: typed, idempotent, retries, compensation | Mock adapters over six synthetic products (FASTER, Ecolane, Bytecurve, **Vestige**, TripShot, telematics) + HTTP adapter templates | `ADAPTER_MODE=http` + base URLs |
| Governance and data: Bedrock, Delta audit log, tracing, cost controls | Model router (mock / Anthropic / Bedrock / Ollama) with token budgets and a model **evaluation suite**; audit log with a transactional outbox shipped to JSONL or Databricks with retries; OpenTelemetry (OTLP) traces per workflow; GCIP sign-in | `LLM_PROVIDER=bedrock`, `AUDIT_MIRROR=databricks`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `AUTH_MODE=gcip` |
| Operator Performance SLM: Databricks feature pipelines, SLM | Feature pipeline over `an_run_history`, per-agency model registry (`an_models`), grounded Q&A, local SLM via Ollama, fine-tuning export | Load real history into the feature table; fine-tune on the exported JSONL |

---

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Python | 3.11, 3.12 or 3.13 (3.12 recommended) | `python --version` (Windows) or `python3 --version` |
| Node.js | 18 or newer (20 LTS recommended) | `node --version` |
| PostgreSQL | 14 or newer (16 recommended) | `psql --version` |
| Ollama (optional) | Any recent version, only for a real local SLM | `ollama --version` |
| Internet | Only for installs and Google Fonts | |

### Install PostgreSQL (once)

The app expects user `postgres` with password `postgres` on `localhost:5432` and **creates the database
`transit_orchestrator` by itself** on first start. Use other credentials by editing `DATABASE_URL` in `backend/.env`.

* **Windows:** download the installer from postgresql.org (EDB). During setup set the `postgres` password to `postgres`
  (or your own, then update `.env`), keep port 5432. The service starts automatically.
* **macOS:** `brew install postgresql@16 && brew services start postgresql@16`, then
  `psql postgres -c "CREATE ROLE postgres WITH LOGIN SUPERUSER PASSWORD 'postgres';"` (Homebrew creates a role named after your Mac user).
  Postgres.app also works.
* **Ubuntu/Debian:** `sudo apt install postgresql && sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"`

No PostgreSQL? Set `DATABASE_URL=sqlite+aiosqlite:///./data/transit.db` in `backend/.env`; everything still works on SQLite.

## 2. Set up (once)

**Windows:** double-click `scripts\setup.bat`, or in Command Prompt:
```bat
scripts\setup.bat
```

**macOS / Linux:**
```bash
./scripts/setup.sh
```

<details><summary>Manual setup (any OS)</summary>

```bash
# backend
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate      macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env      # macOS/Linux: cp .env.example .env

# frontend (new terminal)
cd frontend
npm install
```
</details>

## 3. Run

**Windows:** `scripts\start.bat` (opens two windows). **macOS / Linux:** `./scripts/start.sh`.

Or manually, in two terminals:
```bash
# terminal 1 (from backend/, venv active)
python run.py          # use this rather than plain uvicorn: on Windows it sets the event loop psycopg needs
# terminal 2 (from frontend/)
npm run dev
```

Open **http://localhost:5173**. API docs (Swagger) are at **http://localhost:8000/docs**.

On the very first start the backend creates the PostgreSQL database and tables, generates the synthetic data
(including 120 days of operations history), trains the performance model for each agency, runs demo vehicle-health
and no-show orchestrations so the dashboards have history, and the maintenance scanner finds two buses overdue for
service, so you will see items waiting for approval straight away.

### Demo accounts (password `demo1234` for all)

| Agency | Dispatcher | Shop manager | Operations admin | Analyst (read-only) |
|---|---|---|---|---|
| Metro Valley Transit | dispatcher@mvt.demo | shopmanager@mvt.demo | admin@mvt.demo | viewer@mvt.demo |
| Lakeshore Paratransit | dispatcher@lsp.demo | shopmanager@lsp.demo | admin@lsp.demo | viewer@lsp.demo |

The sign-in screen lists them; click one to fill the form.

## 4. Ten-minute demo script

1. **Sign in as the MVT dispatcher.** Overview shows the success measures against the Phase 0 baseline.
2. **Simulator → Report a vehicle fault.** Pick an in-service bus (for example V-107), choose
   `P0217 Engine coolant over-temperature` (critical) and click *Send fault from telematics*.
3. **Needs your attention.** The agent has assessed severity, found the runs at risk and the spare vehicles,
   and asks to open a work order. Read *Why the agent proposes this*, then **Approve**.
4. Approve **Pull vehicle**. On **Cover runs**, click **Change**, pick another spare or driver for a run,
   add a note, and click **Approve with changes**. Rider notifications go out automatically (policy).
5. Open the orchestration: the line map shows each station; *Runs covered*, *Rider messages* (English,
   Spanish, Chinese) and the *Decision trail* show exactly who did what and why.
6. **Schedule** shows the runs moved to the spare. **Fleet** shows the bus unavailable.
7. **Sign in as the shop manager → Work orders → Close work order.** The agent returns the bus to the
   schedule by itself and the orchestration completes.
8. **Assistant:** ask "Why was V-107 pulled?".
9. **Failure handling:** Simulator → set *Trip management rejects run reassignment* to **Keeps failing**,
   send another critical fault, approve the steps. Reassignment fails, the agent restores the bus to the
   schedule (compensation), keeps the work order open and puts a *Manual action needed* item in the panel.
   Set it to **Fails once** instead to see the retry succeed silently.
10. **Duplicates:** Simulator → *Re-send last fault*. The Event stream shows it as a duplicate; no second
    orchestration starts.
11. **Policy:** sign in as the admin → Autonomy policy → set *Pull vehicle* and *Reassign runs* to
    *Agent acts* → save. The next fault runs straight through to the shop with zero clicks.
    Lakeshore's policy already lets the agent open work orders on its own for critical faults.

### No-Show Recovery (5 minutes)

12. **Simulator → Record a no-show**, choose *a standby rider could take the seat*, click *Record it in trip management*.
13. **Needs your attention:** the card shows the missed pickup, the minutes freed, the best standby rider (medical
    trips first, seat and wheelchair checks, pickup window, extra driving) and whether the missed rider has repeat no-shows.
    **Approve**: the standby rider is booked and gets a confirmation in their language.
14. Record another with *the run is running late*. The agent proposes moving later pickups earlier; the card shows each
    rider's expected time before and after, and how many pickups stop being late. Use **Change** to switch between
    *Book a standby rider*, *Move later pickups earlier* and *Record only*.
15. **Schedule** shows standby riders added to runs and how late each run is running. **Overview** shows minutes freed,
    standby riders seated and late pickups avoided. **Autonomy policy → No-show recovery** sets thresholds and autonomy.

### Operator Performance SLM (5 minutes)

16. **Performance:** move the *Target OTP* slider. The ladder shows which levers get you there and whether the target is
    reachable at all; every lever is a change to your real last-30-day conditions scored by the trained model.
17. Ask "How do we move OTP from 92% to 95%?", "Why are pickups late on Route 4 Airport?", "Which operators should we
    coach first?". Open *Grounded in* under any answer to see the exact facts it used.
18. **Retrain model** creates a new version (registry, holdout metrics, top factors). **Fine-tuning data** downloads a
    chat-format JSONL built from your agency's data for tuning a small model in Databricks.
19. For a real local small language model: install Ollama, run `ollama pull llama3.2:3b`, set `SLM_PROVIDER=ollama`
    in `backend/.env`, restart. Answers are then written by the local model from the same grounded facts.

### Domain agents, Vestige, shadow mode and scenario testing (10 minutes)

20. Open any vehicle orchestration: the **Agents** panel shows the supervisor's plan and every task it delegated, to which
    agent, for which persona (the person who approved, or the policy's "acts for" persona), and how long it took.
21. **Simulator → Report a vehicle fault** with `BRK-02` (brakes). After you approve the work order, the safety agent records
    a **Vestige defect** next to it (Safety & compliance, Fleet); closing the work order clears it.
22. **Simulator → Driver compliance**: let a driver's medical card expire, then send another fault. The cover plan never
    proposes that driver; the Assessment lists who the safety agent ruled out and why.
23. **Admin → Autonomy policy**: untick `trip_mgmt.block_vehicle` for the dispatcher persona and save. A dispatcher approving
    *Pull vehicle* now fails safely and escalates: the agent can never do more than the person it acts for. Restore it.
24. **Shadow mode**: set the run mode to *Shadow* and send a fault. Nothing is executed and nobody is asked. Handle it by hand
    (Fleet → click the vehicle → *Open work order in FASTER* and *Pull from schedule*), then open **Shadow mode**: the agent's recommendations next to what people
    did, agreement, how much earlier the agent was ready, and "Measure Phase 0 baseline". Set the mode back to *Live*.
25. **Simulator → Scenario testing**: *Late, out-of-order and stale signals* shows events handled in event-time order, one
    marked late and one stale; *Fault storm* runs three orchestrations side by side. **Event stream → Export** then
    **Simulator → Replay an event file** replays any captured events.
26. **Model evaluation**: run the suite against the mock (or Anthropic/Bedrock once configured) before any model change.

## 5. What happens inside (the pilot workflow)

```
Telematics DTC / PM overdue ──► event backbone (store, de-duplicate, order)
                                   │
                                   ▼
           LangGraph supervisor (one thread per vehicle incident) → domain agents per product
  1 Detect ─► 2 Assess ─► 3 Open work order ─► 4 Pull vehicle ─► 5 Reassign runs ─► 6 Notify riders ─► 7 Return to service
                │             │ gate              │ gate             │ gate             │ gate            ▲ waits (days) for
                │             ▼                   ▼                  ▼                  ▼                 │ workorder.closed
                │        policy engine: autonomous | semi-autonomous (interrupt → Needs your attention) | informational
                ▼
  deterministic checks (licence, air brakes, wheelchair securement, capacity, wheelchair positions,
  double booking, driver hours, Vestige compliance) + LLM explanation; LLM may only pick among candidates that passed
                                   │
    asset agent · trip agent · workforce agent · safety agent · rider comms agent   (each: own product only,
                                   │                                                 persona's permissions only)
                   adapters (idempotency keys, retries, rate limit, permission check)
                                   ▼
  FASTER (asset)  Ecolane/TripMaster (trips)  Bytecurve (workforce)  Vestige (safety)  TripShot/Passio (riders)
```

* **Gate then execute.** Each write step has a gate node (asks the policy; pauses with `interrupt()` when a
  person must approve) and an exec node (acts through an adapter with an idempotency key, so replays never
  create a second work order or message).
* **Supervisor and domain agents.** The graph is the supervisor: inside each step it delegates every product read
  and write to the agent that owns that product. An agent only holds its own product's permissions, intersected
  with the permissions of the persona it serves, and checks them before acting.
* **Shadow level.** In shadow mode a gate records exactly what the agent would do and moves on without acting;
  manual product actions are matched to it (Shadow mode screen) and counted as manual re-entry.
* **Durable.** Graph state is checkpointed in PostgreSQL (same database as the app); stop the server mid-workflow,
  start it again, and approvals and shop closures still resume the right workflow. Unprocessed events are
  replayed on start.
* **Compensation.** If a step fails after earlier steps succeeded, earlier actions are undone in reverse
  (runs reverted, vehicle restored) according to the policy, and a person is asked to finish.
* **Rejections.** Rejecting the work order stops the workflow. Rejecting the cover plan restores the vehicle
  to its runs so nothing is left uncovered, and keeps the work order open.
* **Audit.** Every event, assessment, decision, approval request, human action, action, failure and
  compensation is written with data considered, model used, recommendation, actor, outcome and trace ID.

### No-Show Recovery workflow

```
trip.no_show / trip.cancelled ─► 1 Detect ─► 2 Assess ─► 3 Adjust schedule (gate) ─► 4 Notify riders (gate) ─► 5 Log recovery
                                             │
              minutes freed (policy), run delay, seats and wheelchair positions free, standby requests whose
              window fits, extra driving per request, later pickups' current vs new ETA, rider's 30-day no-shows
                                             │
                        insert (book standby) | resequence (pull later ETAs earlier) | hold
```
If re-timing fails after a standby booking, the booking and any changed ETAs are undone and a person is asked to finish.

### Operator Performance SLM

```
an_run_history (120 days, run level) ─► feature pipeline (one-hot + scaling) ─► L2 logistic model of late pickups
        (Newton/IRLS in NumPy, last 14 days held out) ─► an_models registry (versioned, metrics, top factors)
                │
question ─► understand (intent, target, route) ─► ground (insights + model-scored what-if plan) ─► SLM writes answer
                                                                       (Ollama local model, cloud model, or built-in composer)
```
Levers: add recovery time on the latest routes, keep vehicles on PM schedule, put experienced operators on the hardest
routes, cut dwell at clinics, relieve PM crowding, reduce no-shows. Each is applied to the last 30 days of real feature
values and scored by the model; the plan stacks them greedily until the target is reached or says it cannot be.

More detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## 6. Synthetic data

Generated deterministically (seed in `.env`) relative to today, so there are always runs for yesterday,
today and the next two days.

| | Metro Valley Transit | Lakeshore Paratransit |
|---|---|---|
| Vehicles | 26 (40ft, 35ft, cutaway, paratransit van), 3 spares, 1 in the shop | 20, 2 spares, 1 in the shop |
| Drivers | 50 with licence class, air-brake and wheelchair certifications, one on leave | 39 |
| Riders | 220 (English / Spanish / Chinese, SMS / app / email) | 130 |
| Runs / trips | 176 runs, about 2,300 rider trips | 136 runs, about 800 trips |
| Standby waitlist | about 120 requests (medical / work / standard, some wheelchair) for today and tomorrow | about 100 |
| Operations history | 120 days, about 4,700 run-days with weather, crowding, recovery, dwell, operator tenure, PM status, breakdowns, no-shows | about 3,600 run-days |
| No-show log | 30 days, about 1,250 entries; a small group of riders causes many of them | about 600 |
| Also | Fault-code catalog, shop bay capacity per depot per day, telematics devices, 2 buses past their PM interval, live run delays, driver hire dates | |

The history has known causes built in (afternoon peak, rain, crowding, low recovery time, long dwell at clinics,
operators under a year, overdue maintenance, breakdowns, plus two problem routes per agency), so the trained model
should rediscover them; the test suite checks that it does. Metro Valley sits near 91.5% OTP, Lakeshore near 89.5%.

Every product uses its own IDs (`FA-20185`, `TM-V105`, `TLM-88A1`, `BC-E1003`…); the identity crosswalk
maps them to canonical IDs (`veh_mvt_105`, `drv_mvt_003`). Reset at any time: Simulator → *Reset demo data*
(admin), or stop the backend and run `python scripts/reset_data.py` (drops the PostgreSQL database; next start rebuilds it).

## 7. Replacing synthetic parts with real systems

See [`docs/REAL_INTEGRATION.md`](docs/REAL_INTEGRATION.md) for the step-by-step checklist. In short:

| Replace | File(s) | Setting |
|---|---|---|
| Product APIs | `backend/app/adapters/http.py` (align paths with vendor docs) | `ADAPTER_MODE=http`, `*_API_BASE_URL`, `*_API_KEY` |
| Products publishing events | `POST /api/events/ingest` with header `X-Ingest-Key` (CloudEvents JSON) | `INGEST_API_KEY` |
| Event backbone | `backend/app/core/event_bus.py` (`EventBridgeEventBus`, `KafkaEventBus`) | `EVENT_BUS=eventbridge` (+ `EVENTBRIDGE_SQS_QUEUE_URL`) or `EVENT_BUS=msk` + `MSK_*` |
| Shared identity layer | `backend/app/identity/service.py` | |
| LLM | `backend/app/llm/providers.py` | `LLM_PROVIDER=anthropic` or `bedrock` + model IDs |
| Audit log in Databricks | `backend/app/audit/sinks.py`, `audit/shipper.py` | `AUDIT_MIRROR=databricks` + `DATABRICKS_*` |
| Tracing | `backend/app/core/tracing.py` | `OTEL_ENABLED=true`, `OTEL_EXPORTER_OTLP_ENDPOINT` |
| Safety & compliance (Vestige) | `backend/app/adapters/http.py` (`HttpSafetyAdapter`) | `SAFETY_API_BASE_URL`, `SAFETY_API_KEY` |
| Operations history for the SLM | Fill `an_run_history` from Databricks (same columns) | then *Retrain model* |
| Performance SLM model | `backend/app/llm/providers.py` (`OllamaProvider`) | `SLM_PROVIDER=ollama` or `anthropic` / `bedrock` |
| SSO (GCIP) | `backend/app/core/gcip.py` (built: ID token verification, tenant mapping) | `AUTH_MODE=gcip`, `GCIP_PROJECT_ID`, `GCIP_API_KEY`, `GCIP_TENANT_MAP` |

Operations: [`docs/RUNBOOK.md`](docs/RUNBOOK.md). Adding the next workflow: [`docs/PATTERN_GUIDE.md`](docs/PATTERN_GUIDE.md)
with the template in `backend/app/orchestrator/template.py`.

## 8. Tests

```bash
cd backend
# venv active
pytest -q
```
45 end-to-end tests against a fresh PostgreSQL test database (`transit_orchestrator_test`, recreated each run, using the
user and password from `DATABASE_URL` in `backend/.env`):
the full seven-step vehicle loop with an override, role checks, rejection paths, informational policy,
de-duplication, transient retry, compensation, durability across an orchestrator restart, tenant isolation, policy
changes, the ingest webhook, the assistant and exports; no-show recovery (standby booking, re-timing, reject, late
cancellation, duplicate event, booking failure with compensation, autonomous policy); and the performance SLM (model
rediscovers the planted causes, versioned retraining, plan reachability, grounded answers by intent, fine-tune export);
and the governance layer (domain agents confined to their product, Vestige defect loop and driver exclusion, persona-bound
permissions, shadow mode with matching and measured baseline, stale / late / out-of-order events, scenario replay, audit
outbox retries, model evaluation, GCIP sign-in, MSK configuration, the workflow template).
Run on SQLite instead with `TEST_DATABASE_URL=sqlite+aiosqlite:///./data/test.db pytest`.
Frontend type check: `cd frontend && npm run typecheck`.

## 9. Project layout

```
backend/
  app/
    main.py                FastAPI app and startup wiring
    core/                  config, database, events (CloudEvents), event bus, SSE hub, security, tracing
    models/                platform tables, identity crosswalk, synthetic product tables
    agents/                supervisor (delegation, personas) and the five domain agents
    products/              six synthetic products incl. Vestige safety (service = business logic, router = REST API)
    identity/              canonical ID resolution
    adapters/              typed interfaces, resilience, mock + HTTP implementations
    policy/                default rules and the autonomy engine
    llm/                   providers (mock/Anthropic/Bedrock/Ollama), the model router, evaluation suite (evals.py)
    orchestrator/          vehicle health graph + assessment, no-show recovery graph (noshow.py), shadow tracker,
                           service, approvals, workflow template (template.py)
    analytics/             performance model (model.py), insights and levers (insights.py), grounded SLM Q&A (slm.py)
    audit/                 audit writer, outbox shipper, mirrors (JSONL / Databricks)
    simulator/             fault injection, telemetry stream, PM scanner, demo history, scenario replay
    api/routes/            REST endpoints used by the UI
    seed/generator.py      synthetic agencies, fleet, drivers, riders, runs, trips
    seed/extras.py         standby waitlist, run delays, hire dates, 120-day history, no-show log
    seed/safety.py         Vestige driver compliance and vehicle ids (also back-fills older databases)
  run.py                   start the backend (python run.py)
  scripts/run_evals.py     model evaluation from the command line (CI gate for model changes)
  tests/                   pytest suite
frontend/
  src/lib/                 API client, auth, live updates (SSE), types, formatting
  src/components/          layout, line map, decision card, UI primitives, toasts
  src/pages/               Overview, Needs your attention, Orchestrations, detail, Performance, Fleet, Schedule,
                           Work orders, Rider messages, Safety & compliance, Audit log, Autonomy policy,
                           Shadow mode, Model evaluation, Event stream, Simulator, Assistant, Sign in
docs/                      architecture, real-integration guide, operations runbook, pattern guide
scripts/                   setup and start scripts for Windows, macOS and Linux
```

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| UI says it can't reach the API | Start the backend first; it must be on port 8000 (the Vite proxy points there). |
| `Cannot connect to PostgreSQL` on start | Start the PostgreSQL service and check user/password/port in `DATABASE_URL`. |
| `permission denied to create database` | Create it yourself: `createdb transit_orchestrator` (or `CREATE DATABASE transit_orchestrator;` in psql), or use a superuser. |
| `Psycopg cannot use the 'ProactorEventLoop'` (Windows) | Start with `python run.py`, not plain `uvicorn`. |
| Ollama answers fail | Check `ollama serve` is running and the model is pulled; the app falls back to the built-in composer automatically. |
| `python` not found on Windows | Install from python.org and tick *Add python.exe to PATH*, or use `py -3.12 -m venv .venv`. |
| PowerShell blocks `activate` | Use Command Prompt, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. |
| Port already in use | `uvicorn app.main:app --port 8001` and change the proxy target in `frontend/vite.config.ts`. |
| Want a clean slate | Stop the backend, run `python scripts/reset_data.py`, start again. |
| No-show simulator says nothing matches | Upcoming pickups for today run out late in the evening; reset demo data (it regenerates relative to now) or choose *anything*. |
| Fonts look plain | Google Fonts need internet; the UI falls back to system fonts offline. |
| `the greenlet library is required` on start | `pip install greenlet` in the venv (now in `requirements.txt`; SQLAlchemy skips it on Apple Silicon). |
| macOS: `python3` is 3.9 | Use `python3.12 -m venv .venv` (`brew install python@3.12`); `scripts/setup.sh` now picks 3.11-3.13 automatically. |
| Tests: `password authentication failed` | Tests use the user/password from `DATABASE_URL` in `backend/.env`; or set `TEST_DATABASE_URL`. |

## 11. Scope notes

* Built: the pilot (Phase 1), the No-Show Recovery agent (Phase 2) and the Operator Performance SLM (Phase 3) on
  synthetic products and history, on PostgreSQL.
* The performance "SLM" locally is three parts: a trained per-agency statistical model (it produces every number),
  grounding (facts and what-if results), and a language layer that writes the answer, which can be a real small
  model running on your machine through Ollama. Fine-tuning a small model on GPUs belongs in Databricks; the export
  gives you the training set.
* Built for production but switched off locally (no cloud accounts needed): EventBridge in/out and MSK backbones, GCIP
  sign-in, OTLP tracing, Databricks audit delivery, Bedrock/Anthropic models. Each is one setting (see section 7).
* Local choices to revisit for production: naive local timestamps → UTC with agency time zones, the in-process schema
  additions → Alembic migrations, synthetic history → the real Databricks feature table.
* Not software: recorded walkthroughs (proposal hypercare deliverable) are recorded at handover; the demo script above is their script.
