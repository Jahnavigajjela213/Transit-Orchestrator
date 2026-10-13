# Pattern guide: adding the next cross-product workflow

The proposal's promise is that new cross-product workflows are added as **configuration and agent logic, not new
integrations**. This guide is the recipe the two existing workflows (vehicle health, no-show recovery) were built
with. Start from `backend/app/orchestrator/template.py`; `tests/test_template.py` keeps it compiling.

Worked example used below: *"Driver compliance lapse → re-cover the driver's runs"* (Vestige publishes
`safety.driver.compliance_changed`; the agent finds the driver's upcoming runs and proposes qualified replacements).

## 0. Decide the shape (30 minutes, with the product owners)

| Question | Example answer |
|---|---|
| Which event starts it, from which product? | `safety.driver.compliance_changed` from Vestige, `compliant: false` |
| Which products does it read and write? | Read: Vestige, Bytecurve (roster), trip management. Write: trip management (`assign_run`), rider comms (`send`) |
| What are the steps, and which are write steps? | Detect → Assess → Reassign runs (write) → Notify riders (write) → Log |
| Who approves each write step at first? | Dispatcher, semi-autonomous; start in shadow mode |
| What must never happen? (hard constraints, in code) | A non-compliant or unqualified driver, double booking, over-hours |
| What undoes a partial failure? | Revert reassigned runs |

## 1. Event (no product integration work if the product already publishes it)

1. Add the type to `EventTypes` and `EventTypes.CATALOG` in `core/events.py` (`triggers: "<workflow_type>"`).
2. Give it a `dedupekey` at the source (e.g. `compliance:<driver>:<issue>:<day>`), so repeats do not start twice.
3. Real products publish via `POST /api/events/ingest`, EventBridge (rule → SQS) or MSK; nothing else changes.

## 2. Policy (configuration, per tenant)

In `policy/defaults.py`:
* `STEPS_BY_TYPE[...]` and `WORKFLOW_NAMES[...]`: the step list shown on the line map.
* `DEFAULT_RULES[...]`: for each step `level`, `approver_roles`, `acts_as`; `mode: "shadow"` to start; `thresholds`;
  `compensation`; `agent_permissions` (only the actions this workflow needs); `persona_permissions` (reuse `PERSONA_PERMISSIONS`).
* `PERMISSIONS_BY_TYPE[...]`. If you introduce a new product action, also add it to `PERSONA_PERMISSIONS` for the personas allowed to do it.

The Autonomy policy screen picks all of this up automatically (it is driven by the policy metadata).

## 3. Domain agents (agent logic)

* Reads and writes go through `_read(...)` / `_delegate(state, rules, step, "<agent>", "<task>", fn, requires=[...])`.
  `requires` lists the product actions the task performs; the agent checks them against the persona before acting.
* Reuse an existing agent when the product already has one (`agents/domain.py`: asset, trip, workforce, safety, rider_comms).
* A new product: add an adapter interface in `adapters/base.py`, mock + HTTP implementations, register it in
  `adapters/registry.py`, add a crosswalk `system`, and add a `DomainAgent(...)` entry. Every write uses `protected_write`
  with an idempotency key built from the workflow id and step.
* Add the step → agents mapping to `ROUTING` in `agents/supervisor.py` so the orchestration screen shows the plan.

## 4. The graph

Copy `orchestrator/template.py` and keep the pattern:

| Node | Rule |
|---|---|
| `assess` | Facts from agents; hard constraints in code (see `assessment.plan_cover` + `safety_block`); the LLM only explains and may choose among candidates that passed (`llm.run("assess", ...)`). Write one `assessment` audit record. |
| `gate_<step>` | `make_gate(step, recommend, options, skip)`. Do not put side effects before `interrupt()`; the shadow branch is built in. |
| `exec_<step>` | One `_delegate(...)` per product task. On `ProductAPIError`/`PolicyViolation`: audit `action_failed`, set the step `failed`, return a `failure`. On success: audit `action_executed`, append to `completed_actions`. |
| compensation | Walk `completed_actions` in reverse and undo through the same agents (`decision={}` so it runs as the step's `acts_as` persona). |
| routing | `GO` → exec; `shadow` → next gate; reject / informational → stop or a restore node. |

Then register it in `OrchestratorService.start()` (`self.graphs[...]`, `bus.subscribe(<event>, handler)`) and write a
small `on_<event>` handler modelled on `on_no_show` (create the `Workflow` row, audit `event_received`, invoke).
Add `TITLES` / `title_for`, `explain_context`, `data_considered` and `final_status` hooks as `noshow.py` does if the
step cards need custom text.

## 5. Approval card and overrides

* What the person sees is `recommend(...)` + `options(...)`; the explanation comes from `llm.run("explain_step", ...)`.
* If the person can change the plan, validate the change server-side in `orchestrator/approvals.py::_validate_override`
  (only options that passed the hard checks).
* The generic DecisionCard renders recommendations; add a branch in `frontend/src/components/DecisionCard.tsx` only for a custom editor.

## 6. Prove it

1. Tests (copy `tests/test_no_show.py`): happy path, override, reject, a product failure with compensation
   (`/api/simulator/failures`), duplicate event, persona without permission, shadow mode.
2. Add a scenario to `simulator/replay.py` and run it from the Simulator.
3. Run the model evaluation suite if you added prompts (add cases to `llm/evals.py::CASES`).
4. Pilot: shadow mode with a design partner → compare on the Shadow mode screen → measure the baseline →
   Needs approval → Agent acts per step when "Ready for more autonomy?" says so.

## Checklist

- [ ] Event type, catalog entry, dedupe key
- [ ] Policy defaults (steps, levels, approvers, acts_as, mode, thresholds, compensation, permissions)
- [ ] Agents + supervisor routing (and adapter/crosswalk if a new product)
- [ ] Graph with gate/exec pairs, compensation, idempotency keys
- [ ] Service registration + trigger handler
- [ ] Approval texts, override validation
- [ ] Tests, scenario, evaluation cases
- [ ] Runbook entry for its incidents
