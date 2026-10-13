import copy

import pytest

from tests.conftest import login
from tests.helpers import inject, pending, workflow_for

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_login_and_roles(client, dispatcher):
    r = await client.post("/api/auth/login", json={"email": "dispatcher@mvt.demo", "password": "wrong"})
    assert r.status_code == 401
    assert (await client.get("/api/workflows")).status_code == 401
    r = await client.put("/api/policies/vehicle_health", json={"rules": {}}, headers=dispatcher)
    assert r.status_code == 403


async def test_tenant_isolation(client, dispatcher):
    lsp = await login(client, "dispatcher@lsp.demo")
    mvt_labels = {v["label"] for v in (await client.get("/api/fleet", headers=dispatcher)).json()}
    lsp_labels = {v["label"] for v in (await client.get("/api/fleet", headers=lsp)).json()}
    assert mvt_labels.isdisjoint(lsp_labels)


async def test_policy_makes_steps_autonomous(client, admin, dispatcher):
    pol = (await client.get("/api/policies/vehicle_health", headers=admin)).json()
    original = copy.deepcopy(pol["rules"])
    rules = copy.deepcopy(original)
    for step in ("open_work_order", "pull_vehicle", "reassign_runs"):
        rules["steps"][step]["level"] = "autonomous"
        rules["steps"][step]["by_severity"] = {}
    r = await client.put("/api/policies/vehicle_health", json={"rules": rules}, headers=admin)
    assert r.status_code == 200 and r.json()["version"] == pol["version"] + 1
    try:
        await inject(client, dispatcher, "V-113", "P0520")
        wf = await workflow_for(client, dispatcher, "V-113")
        assert pending(wf) is None
        assert wf["status"] == "awaiting_event"
        assert wf["human_touches"] == 0
    finally:
        await client.put("/api/policies/vehicle_health", json={"rules": original}, headers=admin)
    audit = (await client.get("/api/audit", params={"record_type": "policy_change"}, headers=admin)).json()
    assert len(audit) >= 2


async def test_invalid_policy_rejected(client, admin):
    pol = (await client.get("/api/policies/vehicle_health", headers=admin)).json()
    rules = copy.deepcopy(pol["rules"])
    rules["steps"]["pull_vehicle"]["level"] = "yolo"
    r = await client.put("/api/policies/vehicle_health", json={"rules": rules}, headers=admin)
    assert r.status_code == 400


async def test_tenant_specific_policy(client):
    """Lakeshore's policy lets the agent open work orders on its own for critical faults."""
    lsp = await login(client, "dispatcher@lsp.demo")
    await inject(client, lsp, "P-210", "BRK-02")
    wf = await workflow_for(client, lsp, "P-210")
    assert {s["key"]: s["status"] for s in wf["steps"]}["open_work_order"] == "done"
    assert pending(wf)["step"] == "pull_vehicle"
