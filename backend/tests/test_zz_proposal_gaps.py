"""Proposal items added after the first build: domain agents and the supervisor, Vestige (safety), persona-bound
permissions, shadow mode, measured baseline and manual re-entry, late / out-of-order / stale events, audit outbox,
model evaluation, scenario replay, GCIP sign-in, MSK config. Runs last (zz) because scenarios pick free vehicles."""
import copy
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.agents import AGENTS
from app.core.clock import now
from app.core.database import SessionLocal
from app.core.errors import PolicyViolation
from app.core.event_bus import bus
from app.models import SafetyDefect, Workflow
from tests.helpers import approve_until, close_work_order, decide, inject, pending, workflow_for

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _policy(client, admin, wtype="vehicle_health") -> dict:
    return (await client.get(f"/api/policies/{wtype}", headers=admin)).json()["rules"]


async def _put_policy(client, admin, rules, wtype="vehicle_health"):
    r = await client.put(f"/api/policies/{wtype}", json={"rules": rules}, headers=admin)
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------- agents + Vestige
async def test_domain_agents_and_vestige_defect_loop(client, dispatcher, shop):
    await inject(client, dispatcher, "V-116", "BRK-02")  # Brakes: also a Vestige defect
    wf = await approve_until(client, dispatcher, "V-116")
    agents_used = {d["key"] for d in wf["context"]["delegations"]}
    assert {"asset", "trip", "workforce", "safety"} <= agents_used
    assert all(d["status"] == "done" for d in wf["context"]["delegations"])
    assert [p["step"] for p in wf["context"]["agent_plan"]][:2] == ["assess", "open_work_order"]
    defect = wf["checkpoint"]["defect"]
    assert defect and defect["status"] == "open"
    # Personas: the work order was opened for the approver's persona, the pull for the dispatcher.
    wo_task = next(d for d in wf["context"]["delegations"] if d["task"] == "create_work_order")
    assert wo_task["persona"] in ("dispatcher", "shop_manager") and wo_task["requires"] == ["asset_mgmt.create_work_order"]
    defects = (await client.get("/products/safety/defects", params={"status": "open"}, headers=dispatcher)).json()
    assert any(d["id"] == defect["defect_id"] and d["vehicle_label"] == "V-116" for d in defects)

    await close_work_order(client, shop, wf)
    wf = await workflow_for(client, dispatcher, "V-116")
    assert wf["status"] == "completed"
    async with SessionLocal() as s:
        d = await s.get(SafetyDefect, defect["defect_id"])
        assert d.status == "closed" and "Repaired under" in d.resolution


async def test_agent_cannot_act_outside_its_product():
    from app.adapters.base import ActionContext

    ctx = ActionContext(tenant_id="ten_mvt", actor="test", allowed_actions={"asset_mgmt.create_work_order", "trip_mgmt.assign_run"})
    with pytest.raises(PolicyViolation, match="only acts on"):
        await AGENTS["trip"].run("x", lambda c: None, ctx, persona="dispatcher", requires=["asset_mgmt.create_work_order"])
    seen = {}

    async def grab(c):
        seen["allowed"] = c.allowed_actions

    await AGENTS["trip"].run("x", grab, ctx, persona="dispatcher", requires=["trip_mgmt.assign_run"])
    assert seen["allowed"] == {"trip_mgmt.assign_run"}  # the agent never holds another product's permissions


async def test_noncompliant_drivers_are_never_proposed(client, dispatcher, admin):
    roster = (await client.get("/products/safety/drivers", headers=dispatcher)).json()
    assert any(not d["compliant"] for d in roster), "seed should include drivers out of compliance"
    bad = {d["name"] for d in roster if not d["compliant"]}
    # Make one more driver non-compliant through Vestige, then plan cover.
    r = await client.post("/api/simulator/driver-compliance", json={"issue": "suspended"}, headers=dispatcher)
    assert r.status_code == 200 and r.json()["compliant"] is False
    bad.add(r.json()["driver"])
    await inject(client, dispatcher, "V-117", "P0217")
    wf = await approve_until(client, dispatcher, "V-117", stop_step="reassign_runs")
    ap = pending(wf)
    assert ap["step"] == "reassign_runs"
    for opts in ap["options"]["per_run"].values():
        assert not ({d["name"] for d in opts["drivers"]} & bad)
    for p in ap["recommendation"]["assignments"]:
        assert p["driver_name"] not in bad
    assert "noncompliant_drivers" in wf["context"]["assessment"]["safety"]
    await client.post("/api/simulator/driver-compliance", json={"driver_name": r.json()["driver"], "issue": "clear"}, headers=dispatcher)
    await decide(client, dispatcher, ap["id"], "reject")


# ---------------------------------------------------------------- persona-bound permissions
async def test_agent_acts_only_within_persona_permissions(client, dispatcher, admin):
    original = await _policy(client, admin)
    rules = copy.deepcopy(original)
    rules["persona_permissions"]["dispatcher"] = [p for p in rules["persona_permissions"]["dispatcher"] if p != "trip_mgmt.block_vehicle"]
    await _put_policy(client, admin, rules)
    try:
        await inject(client, dispatcher, "V-119", "P0217")
        wf = await approve_until(client, dispatcher, "V-119", stop_step="pull_vehicle")
        await decide(client, dispatcher, pending(wf)["id"])  # dispatcher approves, but the dispatcher persona may not pull vehicles
        wf = await workflow_for(client, dispatcher, "V-119")
        steps = {s["key"]: s for s in wf["steps"]}
        assert steps["pull_vehicle"]["status"] == "failed"
        assert "dispatcher persona is not permitted to perform trip_mgmt.block_vehicle" in steps["pull_vehicle"]["detail"]
        failed = [d for d in wf["context"]["delegations"] if d["status"] == "failed"]
        assert failed and failed[0]["task"] == "block_vehicle" and failed[0]["persona"] == "dispatcher"
        assert pending(wf, "escalation")
    finally:
        await _put_policy(client, admin, original)


async def test_policy_rejects_unknown_permissions(client, admin):
    rules = await _policy(client, admin)
    rules["persona_permissions"]["dispatcher"] = ["trip_mgmt.teleport_vehicle"]
    r = await client.put("/api/policies/vehicle_health", json={"rules": rules}, headers=admin)
    assert r.status_code == 400 and "unknown permission" in r.json()["detail"]


# ---------------------------------------------------------------- shadow mode, manual re-entry, measured baseline
async def test_shadow_mode_compares_agent_with_people(client, dispatcher, shop, admin):
    original = await _policy(client, admin)
    rules = copy.deepcopy(original)
    rules["mode"] = "shadow"
    await _put_policy(client, admin, rules)
    try:
        await inject(client, dispatcher, "V-120", "P0217")
        wf = await workflow_for(client, dispatcher, "V-120")
        assert wf["status"] == "shadow"
        steps = {s["key"]: s["status"] for s in wf["steps"]}
        assert steps["open_work_order"] == steps["pull_vehicle"] == steps["reassign_runs"] == "shadowed"
        assert not wf["approvals"], "shadow mode asks no one"
        assert not wf["checkpoint"]["work_order"], "shadow mode takes no action"
        recs = {r["step"]: r for r in wf["shadow"]}
        assert recs["open_work_order"]["recommendation"]["priority"] == "critical"

        # People handle it by hand in the products, as they do today.
        assets = (await client.get("/products/asset-mgmt/assets", headers=dispatcher)).json()
        asset = next(a for a in assets if a["unit_label"] == "V-120")
        r = await client.post("/products/asset-mgmt/work-orders", json={"asset_number": asset["asset_number"], "priority": "critical",
                                                                         "title": "Coolant over-temp (by hand)"}, headers=shop)
        assert r.status_code == 200, r.text
        vehicles = (await client.get("/products/trip-mgmt/vehicles", headers=dispatcher)).json()
        code = next(v["vehicle_code"] for v in vehicles if v["label"] == "V-120")
        r = await client.post(f"/products/trip-mgmt/vehicles/{code}/block", json={"end": (now() + timedelta(hours=8)).isoformat()}, headers=dispatcher)
        assert r.status_code == 200, r.text
        await bus.drain()

        wf = await workflow_for(client, dispatcher, "V-120")
        recs = {r["step"]: r for r in wf["shadow"]}
        assert recs["open_work_order"]["status"] == "matched" and recs["open_work_order"]["agreement_pct"] == 100
        assert recs["pull_vehicle"]["status"] == "matched"
        assert recs["open_work_order"]["agent_ahead_minutes"] is not None
        assert len(wf["context"]["manual_entries"]) == 2

        r = await client.post(f"/api/shadow/{recs['open_work_order']['id']}/review", json={"verdict": "same", "note": "agreed"}, headers=dispatcher)
        assert r.status_code == 200 and r.json()["verdict"] == "same"
        summary = (await client.get("/api/shadow/summary", headers=dispatcher)).json()
        wo = next(x for x in summary["steps"] if x["step"] == "open_work_order")
        assert wo["matched"] >= 1 and wo["agreement_pct"] == 100

        # Phase 0 baseline measured from what people did in shadow mode.
        r = await client.post("/api/metrics/baseline/measure", headers=admin)
        assert r.status_code == 200, r.text
        assert r.json()["source"] == "measured_shadow" and r.json()["values"]["manual_reentries_per_incident"] == 2
        m = (await client.get("/api/metrics/summary", headers=dispatcher)).json()
        assert m["baseline_source"] == "measured_shadow"
        assert m["shadow"]["workflows"] >= 1 and m["measures"]["manual_reentries_per_incident"] is not None
        assert "autonomy_readiness" in m and "dispatcher_acceptance_weekly" in m["measures"]
    finally:
        await _put_policy(client, admin, original)


async def test_baseline_can_be_entered(client, admin, dispatcher):
    r = await client.put("/api/metrics/baseline", json={"values": {"detect_to_work_order_minutes": 240}, "notes": "Discovery workshop"}, headers=admin)
    assert r.status_code == 200 and r.json()["values"]["detect_to_work_order_minutes"] == 240 and r.json()["source"] == "entered"
    assert (await client.put("/api/metrics/baseline", json={"values": {"made_up": 1}}, headers=admin)).status_code == 400


async def test_shadow_steps_done_by_hand_from_the_shadow_screen(client, dispatcher, admin):
    """A tester plays the person on shift from the Shadow mode screen: each by-hand action goes through the product and
    is matched to the agent's proposal, with a side-by-side comparison; a step can be closed as not needed."""
    original = await _policy(client, admin)
    rules = copy.deepcopy(original)
    rules["mode"] = "shadow"
    await _put_policy(client, admin, rules)
    try:
        await inject(client, dispatcher, "V-121", "BRK-02")
        wf = await workflow_for(client, dispatcher, "V-121")
        recs = {r["step"]: r for r in wf["shadow"]}
        wo = recs["open_work_order"]
        assert wo["status"] == "open" and wo["no_action_at"] and wo["comparison"] == []

        # a different priority than the agent's: matched loosely, scored 60%
        other = "high" if wo["recommendation"]["priority"] != "high" else "medium"
        r = await client.post(f"/api/shadow/{wo['id']}/by-hand", json={"priority": other}, headers=dispatcher)
        assert r.status_code == 200, r.text
        await bus.drain()
        rows = {x["step"]: x for x in (await client.get("/api/shadow", headers=dispatcher)).json() if x["workflow_id"] == wf["id"]}
        assert rows["open_work_order"]["status"] == "differed" and rows["open_work_order"]["agreement_pct"] == 60
        c = rows["open_work_order"]["comparison"][0]
        assert c["agent"] == wo["recommendation"]["priority"] and c["person"] == f"{other} priority" and c["score"] == 60

        # run cover exactly as the agent proposed: 100%
        plan = [a for a in recs["reassign_runs"]["recommendation"].get("assignments", []) if a.get("vehicle_id")]
        if plan:
            opts = (await client.get(f"/api/shadow/{recs['reassign_runs']['id']}/options", headers=dispatcher)).json()
            assert opts["vehicles"] and opts["drivers"]
            r = await client.post(f"/api/shadow/{recs['reassign_runs']['id']}/by-hand", headers=dispatcher, json={
                "assignments": [{"run_id": a["run_id"], "vehicle_id": a["vehicle_id"], "driver_id": a["driver_id"]} for a in plan]})
            assert r.status_code == 200, r.text
            await bus.drain()
            rows = {x["step"]: x for x in (await client.get("/api/shadow", headers=dispatcher)).json() if x["workflow_id"] == wf["id"]}
            assert rows["reassign_runs"]["status"] == "matched" and rows["reassign_runs"]["agreement_pct"] == 100

        # a step the person decided was not needed
        r = await client.post(f"/api/shadow/{recs['pull_vehicle']['id']}/no-action", headers=dispatcher)
        assert r.status_code == 200 and r.json()["status"] == "no_action"
        assert (await client.post(f"/api/shadow/{recs['pull_vehicle']['id']}/no-action", headers=dispatcher)).status_code == 400

        # Overview: with the saved baseline cleared, it is measured live from these shadow incidents
        r = await client.delete("/api/metrics/baseline", headers=admin)
        assert r.status_code == 200 and r.json()["source"] == "shadow_live"
        m = (await client.get("/api/metrics/summary", headers=dispatcher)).json()
        assert m["baseline_source"] == "shadow_live" and m["baseline"]["manual_reentries_per_incident"] is not None
        ops = m["operations"]
        assert ops["vehicles"]["total"] > 0 and ops["runs_today"]["total"] >= 0 and "on_time" in ops
    finally:
        await _put_policy(client, admin, original)
    assert (await client.put("/api/metrics/baseline", json={"values": {"runs_covered_pct": 50}}, headers=dispatcher)).status_code == 403


# ---------------------------------------------------------------- late / out-of-order / stale events
async def test_stale_and_late_events(client, dispatcher):
    old = {"type": "vehicle.fault.detected", "source": "telematics", "tenantid": "ten_mvt", "time": (now() - timedelta(hours=30)).isoformat(),
           "data": {"device_id": "TLM-NONE", "fault_code": "P0420"}}
    r = await client.post("/api/events/ingest", json=old, headers={"X-Ingest-Key": "local-ingest-key"})
    await bus.drain()
    ev = next(e for e in (await client.get("/api/events", headers=dispatcher)).json() if e["id"] == r.json()["id"])
    assert ev["status"] == "stale" and "older than" in ev["error"]

    res = (await client.post("/api/simulator/scenarios/run", json={"scenario_id": "late_out_of_order"}, headers=dispatcher)).json()
    by_type = {}
    for e in res["events"]:
        by_type.setdefault(e["type"], []).append(e)
    faults = sorted(by_type["vehicle.fault.detected"], key=lambda e: e["time"])
    assert faults[0]["status"] == "stale"  # 30 h old
    assert faults[1]["status"] == "processed" and "min after it happened" in (faults[1]["note"] or "")
    assert by_type["vehicle.pm.overdue"][0]["status"] == "processed"


async def test_dispatch_follows_event_time():
    from app.core.events import CloudEvent
    from app.core.event_bus import InMemoryEventBus

    b = InMemoryEventBus()  # not started: we only use it to persist and order
    t = now()
    late = CloudEvent(type="vehicle.availability.changed", source="trip_mgmt", tenantid="ten_mvt", time=t - timedelta(minutes=10), data={})
    early = CloudEvent(type="vehicle.availability.changed", source="trip_mgmt", tenantid="ten_mvt", time=t - timedelta(minutes=30), data={})
    await b.publish(late)
    await b.publish(early)
    assert await b._in_event_time_order([late.id, early.id]) == [early.id, late.id]
    from app.models import EventRecord

    async with SessionLocal() as s:  # tidy up: these were never dispatched
        for e in (late, early):
            rec = await s.get(EventRecord, e.id)
            rec.status = "ignored"
        await s.commit()


# ---------------------------------------------------------------- scenario replay
async def test_fault_storm_scenario_and_event_replay(client, dispatcher):
    scen = (await client.get("/api/simulator/scenarios", headers=dispatcher)).json()
    assert {s["id"] for s in scen} >= {"peak_brake_fault", "fault_storm", "late_out_of_order", "no_show_cluster"}
    res = (await client.post("/api/simulator/scenarios/run", json={"scenario_id": "fault_storm"}, headers=dispatcher)).json()
    assert [e["status"] for e in res["events"]] == ["processed"] * 3
    async with SessionLocal() as s:
        subjects = [e["subject"] for e in res["events"]]
        wfs = (await s.execute(select(Workflow).where(Workflow.vehicle_id.in_(subjects), Workflow.workflow_type == "vehicle_health"))).scalars().all()
        assert len({w.vehicle_id for w in wfs}) == 3

    export = await client.get("/api/events/export", params={"since_hours": 1, "type": "vehicle.fault.detected"}, headers=dispatcher)
    lines = [ln for ln in export.text.splitlines() if ln.strip()]
    assert lines
    import json

    events = [json.loads(ln) for ln in lines[-2:]]
    r = await client.post("/api/simulator/replay", json={"events": events, "keep_dedupe": True}, headers=dispatcher)
    assert r.status_code == 200, r.text
    assert all(e["status"] == "duplicate" for e in r.json()["events"])  # same dedupe keys within the window


# ---------------------------------------------------------------- audit outbox
async def test_audit_outbox_retries_until_delivered(monkeypatch):
    from app.audit import service as audit_service
    from app.audit import shipper as shipper_mod
    from app.audit.sinks import AuditMirror
    from app.models import AuditOutbox

    class Flaky(AuditMirror):
        def __init__(self):
            self.calls, self.got = 0, []

        async def write_batch(self, records):
            self.calls += 1
            if self.calls == 1:
                raise ConnectionError("Databricks SQL warehouse unavailable")
            self.got.extend(records)

    flaky = Flaky()
    monkeypatch.setattr(audit_service, "mirror", flaky)
    monkeypatch.setattr(shipper_mod, "mirror", flaky)
    async with SessionLocal() as s:
        rec = await audit_service.record(s, tenant_id="ten_mvt", record_type="policy_change", actor="test", explanation="outbox test")
        await s.commit()
    assert await shipper_mod.shipper.flush() == 0  # mirror down: nothing lost, retried later
    async with SessionLocal() as s:
        row = await s.get(AuditOutbox, rec.id)
        assert row.status == "pending" and row.attempts == 1 and "unavailable" in row.last_error
        row.next_attempt_at = now()
        await s.commit()
    assert await shipper_mod.shipper.flush() >= 1
    async with SessionLocal() as s:
        assert (await s.get(AuditOutbox, rec.id)).status == "sent"
    assert any(r["id"] == rec.id for r in flaky.got)


# ---------------------------------------------------------------- model evaluation
async def test_model_evaluation_suite(client, admin, dispatcher):
    r = await client.post("/api/evals/run", json={"provider": "mock"}, headers=admin)
    assert r.status_code == 200, r.text
    run = r.json()
    assert run["status"] in ("passed", "failed") and run["score_pct"] is not None
    ids = {c["id"] for c in run["cases"]}
    assert {"assess_critical", "assess_injection", "assistant_unanswerable", "slm_plan"} <= ids
    inj = next(c for c in run["cases"] if c["id"] == "assess_injection")
    assert all(x["passed"] for x in inj["checks"] if "injected" in x["name"] or "candidates" in x["name"])
    missing = (await client.post("/api/evals/run", json={"provider": "anthropic"}, headers=admin)).json()
    assert missing["status"] == "error" and "not configured" in missing["summary"]["error"]
    assert (await client.post("/api/evals/run", json={"provider": "mock"}, headers=dispatcher)).status_code == 403
    listing = (await client.get("/api/evals", headers=dispatcher)).json()
    assert len(listing["runs"]) >= 2 and listing["cases"]


# ---------------------------------------------------------------- GCIP
async def test_gcip_sign_in(client, monkeypatch):
    from app.core import gcip
    from app.core.config import settings

    monkeypatch.setattr(settings, "auth_mode", "gcip")
    monkeypatch.setattr(settings, "gcip_project_id", "transittech-test")
    monkeypatch.setattr(settings, "gcip_tenant_map", "mvt-tenant-1:ten_mvt")
    claims = {"sub": "abc", "email": "dispatcher@mvt.demo", "email_verified": True, "firebase": {"tenant": "mvt-tenant-1"}}
    monkeypatch.setattr(gcip, "_verify_sync", lambda token: dict(claims))

    cfg = (await client.get("/api/auth/config")).json()
    assert cfg["mode"] == "gcip" and cfg["gcip"]["tenants"] == [{"gcip_tenant_id": "mvt-tenant-1", "tenant_id": "ten_mvt", "name": "Metro Valley Transit"}]
    assert (await client.post("/api/auth/login", json={"email": "dispatcher@mvt.demo", "password": "demo1234"})).status_code == 403
    r = await client.post("/api/auth/gcip", json={"id_token": "x.y.z"})
    assert r.status_code == 200 and r.json()["user"]["role"] == "dispatcher"
    # API clients may send the GCIP ID token directly.
    assert (await client.get("/api/auth/me", headers={"Authorization": "Bearer x.y.z"})).json()["email"] == "dispatcher@mvt.demo"

    claims.update(firebase={"tenant": "lsp-tenant-9"})
    assert (await client.post("/api/auth/gcip", json={"id_token": "x.y.z"})).status_code == 401  # unmapped tenant
    claims.update(firebase={"tenant": "mvt-tenant-1"}, email_verified=False)
    assert (await client.post("/api/auth/gcip", json={"id_token": "x.y.z"})).status_code == 401


# ---------------------------------------------------------------- backbone configuration
async def test_msk_client_config(monkeypatch):
    from app.core.config import settings
    from app.core.event_bus import KafkaEventBus

    monkeypatch.setattr(settings, "msk_bootstrap_servers", "b-1.msk.example:9096")
    monkeypatch.setattr(settings, "msk_security_protocol", "SASL_SSL")
    monkeypatch.setattr(settings, "msk_sasl_mechanism", "SCRAM-SHA-512")
    monkeypatch.setattr(settings, "msk_username", "orchestrator")
    monkeypatch.setattr(settings, "msk_password", "secret")
    kw = KafkaEventBus()._client_kwargs()
    assert kw["sasl_mechanism"] == "SCRAM-SHA-512" and kw["security_protocol"] == "SASL_SSL" and "ssl_context" in kw
    monkeypatch.setattr(settings, "msk_sasl_mechanism", "AWS_MSK_IAM")
    kw = KafkaEventBus()._client_kwargs()
    assert kw["sasl_mechanism"] == "OAUTHBEARER" and kw["sasl_oauth_token_provider"] is not None


async def test_buffered_signal_for_an_already_repaired_fault_is_stale(client, dispatcher):
    # V-116's BRK-02 was repaired in the first test of this file. A buffered copy of that DTC arriving now is stale;
    # a different fault from before the repair is still acted on.
    base = {"source": "telematics", "tenantid": "ten_mvt", "subject": "veh_mvt_116", "type": "vehicle.fault.detected",
            "time": (now() - timedelta(minutes=30)).isoformat()}
    same = await client.post("/api/events/ingest", json={**base, "data": {"fault_code": "BRK-02"}}, headers={"X-Ingest-Key": "local-ingest-key"})
    other = await client.post("/api/events/ingest", json={**base, "data": {"fault_code": "TPMS-1"}}, headers={"X-Ingest-Key": "local-ingest-key"})
    await bus.drain()
    events = {e["id"]: e for e in (await client.get("/api/events", headers=dispatcher)).json()}
    assert events[same.json()["id"]]["status"] == "stale" and "already handled" in events[same.json()["id"]]["error"]
    assert events[other.json()["id"]]["status"] == "processed"


async def test_pre_vestige_policies_are_upgraded_once():
    from app.models import Policy
    from app.policy.defaults import AGENT_PERMISSIONS
    from app.policy.engine import policy_engine

    async with SessionLocal() as s:
        p = (await s.execute(select(Policy).where(Policy.tenant_id == "ten_lsp", Policy.workflow_type == "vehicle_health"))).scalar_one()
        old = {k: v for k, v in copy.deepcopy(p.rules).items() if k != "safety"}
        old["agent_permissions"] = [a for a in AGENT_PERMISSIONS if not a.startswith("safety.")]
        p.rules = old
        await s.commit()
    async with SessionLocal() as s:
        assert await policy_engine.upgrade_stored_policies(s) == 1
        await s.commit()
    async with SessionLocal() as s:
        p = (await s.execute(select(Policy).where(Policy.tenant_id == "ten_lsp", Policy.workflow_type == "vehicle_health"))).scalar_one()
        assert {"safety.open_defect", "safety.close_defect"} <= set(p.rules["agent_permissions"]) and "safety" in p.rules
        assert await policy_engine.upgrade_stored_policies(s) == 0  # idempotent
