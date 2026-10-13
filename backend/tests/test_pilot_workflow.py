"""End-to-end: Vehicle Health -> Service Continuity, all seven steps."""
import pytest

from tests.helpers import approve_until, close_work_order, decide, inject, pending, workflow_for

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_full_loop_with_override(client, dispatcher, shop):
    await inject(client, dispatcher, "V-107", "P0217")
    wf = await workflow_for(client, dispatcher, "V-107")
    assert wf["status"] == "awaiting_approval"
    assert wf["severity"] == "critical"
    steps = {s["key"]: s["status"] for s in wf["steps"]}
    assert steps["detect"] == "done" and steps["assess"] == "done"
    ap = pending(wf)
    assert ap["step"] == "open_work_order"
    assert ap["explanation"] and ap["recommendation"]["priority"] == "critical"

    # Shop manager may approve the work order step (dispatcher or shop manager).
    await decide(client, shop, ap["id"])
    wf = await workflow_for(client, dispatcher, "V-107")
    assert pending(wf)["step"] == "pull_vehicle"
    assert wf["work_order_opened_at"] is not None

    # Shop manager may NOT approve pulling the vehicle.
    r = await client.post(f"/api/approvals/{pending(wf)['id']}/decision", json={"action": "approve"}, headers=shop)
    assert r.status_code == 403

    await decide(client, dispatcher, pending(wf)["id"])
    wf = await workflow_for(client, dispatcher, "V-107")
    reassign = pending(wf)
    assert reassign["step"] == "reassign_runs"
    plan = reassign["recommendation"]["assignments"]
    assert plan, "expected runs at risk for a critical fault on an in-service bus"

    # Override: for each run pick the last vehicle candidate that passed the checks.
    overrides = []
    for a in plan:
        opts = reassign["options"]["per_run"][a["run_id"]]
        if opts["vehicles"] and opts["drivers"]:
            overrides.append({"run_id": a["run_id"], "vehicle_id": opts["vehicles"][-1]["vehicle_id"], "driver_id": opts["drivers"][0]["driver_id"]})
    await decide(client, dispatcher, reassign["id"], "override", override={"assignments": overrides}, note="Prefer this spare")

    wf = await workflow_for(client, dispatcher, "V-107")
    steps = {s["key"]: s["status"] for s in wf["steps"]}
    assert steps["reassign_runs"] == "done"
    assert steps["notify_riders"] == "done"  # autonomous by default
    assert wf["status"] == "awaiting_event"   # waiting for the shop
    assert wf["notification_count"] > 0

    sched = (await client.get("/api/schedule", headers=dispatcher)).json()
    moved = [r for r in sched["runs"] if r["workflow_id"] == wf["id"]]
    for r in moved:
        assert r["original_vehicle_label"] == "V-107"

    fleet = {v["label"]: v for v in (await client.get("/api/fleet", headers=dispatcher)).json()}
    assert fleet["V-107"]["schedule_status"] == "unavailable"

    await close_work_order(client, shop, wf)
    wf = await workflow_for(client, dispatcher, "V-107")
    assert wf["status"] == "completed"
    assert all(s["status"] in ("done", "skipped") for s in wf["steps"])
    fleet = {v["label"]: v for v in (await client.get("/api/fleet", headers=dispatcher)).json()}
    assert fleet["V-107"]["schedule_status"] == "available"

    kinds = [a["record_type"] for a in wf["audit"]]
    for k in ("event_received", "assessment", "approval_requested", "human_action", "action_executed", "workflow_status"):
        assert k in kinds
    overridden = [a for a in wf["audit"] if a["record_type"] == "human_action" and a["human_action"] == "overridden"]
    assert overridden and overridden[0]["explanation"] == "Prefer this spare"


async def test_reject_work_order_stops_workflow(client, dispatcher):
    await inject(client, dispatcher, "V-108", "C1201")
    wf = await workflow_for(client, dispatcher, "V-108")
    await decide(client, dispatcher, pending(wf)["id"], "reject", note="Driver reports it is fine; monitoring")
    wf = await workflow_for(client, dispatcher, "V-108")
    assert wf["status"] == "rejected"
    assert {s["key"]: s["status"] for s in wf["steps"]}["pull_vehicle"] == "not_run"


async def test_low_severity_is_informational(client, dispatcher):
    await inject(client, dispatcher, "V-111", "P0420")
    wf = await workflow_for(client, dispatcher, "V-111")
    assert wf["status"] == "informational"
    card = pending(wf, "informational")
    assert card is not None
    await decide(client, dispatcher, card["id"], "acknowledge")


async def test_reject_cover_plan_restores_vehicle(client, dispatcher, shop):
    await inject(client, dispatcher, "V-115", "P0300")
    wf = await approve_until(client, dispatcher, "V-115", stop_step="reassign_runs")
    ap = pending(wf)
    if ap is None:  # no runs at risk at this time of day; nothing to reject
        return
    await decide(client, dispatcher, ap["id"], "reject", note="Will cover manually")
    wf = await workflow_for(client, dispatcher, "V-115")
    steps = {s["key"]: s["status"] for s in wf["steps"]}
    assert steps["pull_vehicle"] == "compensated"
    assert wf["status"] == "awaiting_event"
    await close_work_order(client, shop, wf)
    wf = await workflow_for(client, dispatcher, "V-115")
    assert wf["status"] == "completed_with_issues"
