import pytest

from app.core.database import SessionLocal
from app.identity.service import identity
from tests.helpers import inject

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_identity_crosswalk():
    async with SessionLocal() as s:
        vid = await identity.by_label(s, "ten_mvt", "vehicle", "V-105")
        ids = await identity.all_ids(s, "ten_mvt", vid)
        assert set(ids) == {"asset_mgmt", "trip_mgmt", "telematics", "safety"}
        assert await identity.map_external(s, "ten_mvt", "telematics", "asset_mgmt", ids["telematics"]) == ids["asset_mgmt"]


async def test_ingest_webhook(client, dispatcher):
    ev = {"type": "vehicle.fault.detected", "source": "telematics", "tenantid": "ten_mvt",
          "data": {"device_id": "UNKNOWN-DEVICE", "fault_code": "P0420"}}
    r = await client.post("/api/events/ingest", json=ev, headers={"X-Ingest-Key": "wrong"})
    assert r.status_code == 401
    r = await client.post("/api/events/ingest", json=ev, headers={"X-Ingest-Key": "local-ingest-key"})
    assert r.status_code == 202
    from app.core.event_bus import bus
    await bus.drain()
    events = (await client.get("/api/events", params={"status": "failed"}, headers=dispatcher)).json()
    assert any(e["id"] == r.json()["id"] for e in events)  # unknown device is recorded as failed, not lost


async def test_assistant_explains(client, dispatcher):
    r = await client.post("/api/assistant/ask", json={"question": "Why was V-107 pulled?"}, headers=dispatcher)
    assert r.status_code == 200
    body = r.json()
    assert body["vehicle_label"] == "V-107"
    assert "V-107" in body["answer"]


async def test_metrics_and_exports(client, dispatcher):
    m = (await client.get("/api/metrics/summary", headers=dispatcher)).json()
    assert m["measures"]["manual_reentries_per_incident"] == 0
    assert m["workflows"]["total"] >= 1
    r = await client.get("/api/audit/export", params={"format": "csv"}, headers=dispatcher)
    assert r.status_code == 200 and "record_type" in r.text.splitlines()[0]
    r = await client.get("/api/audit/export", params={"format": "jsonl"}, headers=dispatcher)
    assert r.status_code == 200


async def test_metrics_system_is_admin_only(client, dispatcher, admin):
    r = await client.get("/api/metrics/system", headers=dispatcher)
    assert r.status_code == 403
    r = await client.get("/api/metrics/system", headers=admin)
    assert r.status_code == 200
    body = r.json()
    assert "adapters" in body and isinstance(body["adapters"], dict)
    assert body["llm_provider"]


async def test_product_apis(client, dispatcher):
    for path in ("/products/asset-mgmt/assets", "/products/asset-mgmt/work-orders", "/products/trip-mgmt/vehicles",
                 "/products/trip-mgmt/runs", "/products/workforce/employees", "/products/rider-comms/notifications",
                 "/products/telematics/devices", "/api/events/catalog", "/api/system/info"):
        r = await client.get(path, headers=dispatcher)
        assert r.status_code == 200, path
