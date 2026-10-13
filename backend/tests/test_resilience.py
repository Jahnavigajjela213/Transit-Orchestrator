"""De-duplication, retries, compensation, durability across restarts."""
import pytest

from app.orchestrator.service import orchestrator
from tests.helpers import approve_until, close_work_order, decide, inject, pending, workflow_for

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_duplicate_events_do_not_start_second_workflow(client, dispatcher):
    await inject(client, dispatcher, "V-105", "BRK-02")
    await inject(client, dispatcher, "V-105", "BRK-02")  # same device+code within the hour
    events = (await client.get("/api/events", params={"type": "vehicle.fault.detected"}, headers=dispatcher)).json()
    v105 = [e for e in events if e["data"].get("fault_code") == "BRK-02"]
    assert sorted(e["status"] for e in v105)[:2] == ["duplicate", "processed"]
    # A different fault on the same vehicle attaches to the active workflow instead of starting another.
    await inject(client, dispatcher, "V-105", "HVAC-05")
    rows = (await client.get("/api/workflows", params={"vehicle": "V-105", "workflow_type": "vehicle_health"}, headers=dispatcher)).json()
    assert len(rows) == 1
    wf = await workflow_for(client, dispatcher, "V-105")
    assert any(a["outcome"] == "attached_to_active_workflow" for a in wf["audit"])


async def test_reassign_failure_runs_compensation(client, dispatcher, shop, admin):
    r = await client.post("/api/simulator/failures", json={"target": "trip_mgmt.assign_run", "mode": "fail_always"}, headers=admin)
    assert r.status_code == 200
    try:
        await inject(client, dispatcher, "V-109", "P0217")
        wf = await approve_until(client, dispatcher, "V-109")
    finally:
        await client.post("/api/simulator/failures", json={"target": "trip_mgmt.assign_run", "mode": "off"}, headers=admin)
    steps = {s["key"]: s["status"] for s in wf["steps"]}
    if steps["reassign_runs"] == "skipped":
        pytest.skip("no runs at risk at this time of day")
    assert steps["reassign_runs"] == "failed"
    assert steps["pull_vehicle"] == "compensated"
    assert any(a["record_type"] == "compensation" for a in wf["audit"])
    esc = pending(wf, "escalation")
    assert esc is not None and "failed" in esc["summary"]
    fleet = {v["label"]: v for v in (await client.get("/api/fleet", headers=dispatcher)).json()}
    assert fleet["V-109"]["schedule_status"] != "unavailable"  # restored to the schedule
    assert wf["status"] == "awaiting_event"  # work order kept open for the shop
    await close_work_order(client, shop, wf)
    wf = await workflow_for(client, dispatcher, "V-109")
    assert wf["status"] == "compensated"


async def test_transient_failure_is_retried(client, dispatcher, admin):
    await client.post("/api/simulator/failures", json={"target": "trip_mgmt.block_vehicle", "mode": "fail_once"}, headers=admin)
    await inject(client, dispatcher, "V-110", "C1201")
    wf = await approve_until(client, dispatcher, "V-110", stop_step="reassign_runs")
    steps = {s["key"]: s["status"] for s in wf["steps"]}
    assert steps["pull_vehicle"] == "done"  # first attempt failed, retry succeeded
    failures = (await client.get("/api/simulator/failures", headers=admin)).json()
    assert next(f for f in failures if f["target"] == "trip_mgmt.block_vehicle")["mode"] == "off"


async def test_workflow_survives_orchestrator_restart(client, dispatcher):
    await inject(client, dispatcher, "V-114", "LIFT-01")
    wf = await workflow_for(client, dispatcher, "V-114")
    ap = pending(wf)
    assert ap["step"] == "open_work_order"
    # Simulate a process restart: drop the compiled graph and its checkpoint connection.
    await orchestrator.stop()
    await orchestrator.start()
    await decide(client, dispatcher, ap["id"])
    wf = await workflow_for(client, dispatcher, "V-114")
    assert pending(wf)["step"] == "pull_vehicle"
    assert {s["key"]: s["status"] for s in wf["steps"]}["open_work_order"] == "done"
