"""No-Show Recovery: insert a standby rider, re-time later pickups, reject, failures, policy."""
import copy

import pytest
from sqlalchemy import select

from app.core.database import SessionLocal
from app.core.event_bus import bus
from app.models import Notification, TripRequest
from tests.conftest import login
from tests.helpers import decide

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def mark(client, headers, prefer="any", kind="no_show", run_id=None):
    r = await client.post("/api/simulator/no-show", json={"prefer": prefer, "kind": kind, "run_id": run_id}, headers=headers)
    assert r.status_code == 200, r.text
    await bus.drain()
    _last_trip["id"] = r.json()["trip_id"]
    return r.json()


_last_trip: dict = {}


async def latest_noshow(client, headers):
    """The orchestration started by the most recent mark() call (matched by trip id)."""
    rows = (await client.get("/api/workflows", params={"workflow_type": "no_show_recovery", "limit": 200}, headers=headers)).json()
    for w in rows:
        d = (await client.get(f"/api/workflows/{w['id']}", headers=headers)).json()
        if (d.get("trigger_event") or {}).get("data", {}).get("trip_id") == _last_trip.get("id"):
            return d
    raise AssertionError("orchestration for the last no-show not found")


def pending(wf, kind="approval"):
    return next((a for a in wf["approvals"] if a["status"] == "pending" and a["kind"] == kind), None)


async def test_standby_rider_fills_freed_seat(client, dispatcher):
    m = await mark(client, dispatcher, prefer="standby")
    wf = await latest_noshow(client, dispatcher)
    assert wf["trigger_event"]["data"]["trip_id"] == m["trip_id"]
    assert [s["key"] for s in wf["steps"]] == ["detect", "assess", "adjust_schedule", "notify_riders", "close"]
    ap = pending(wf)
    assert ap and ap["step"] == "adjust_schedule"
    assert ap["recommendation"]["mode"] == "insert"
    cand = ap["recommendation"]["candidate"]
    await decide(client, dispatcher, ap["id"])
    wf = await latest_noshow(client, dispatcher)
    assert wf["status"] == "completed"
    rec = wf["context"]["recovery"]
    assert rec["standby_booked"] and rec["minutes_saved"] > 0
    async with SessionLocal() as s:
        req = await s.get(TripRequest, cand["request_id"])
        assert req.status == "booked" and req.booked_trip_id
        msgs = (await s.execute(select(Notification).where(Notification.workflow_id == wf["id"]))).scalars().all()
        assert any(n.kind == "booking_confirmed" for n in msgs)


async def test_retime_later_pickups(client, dispatcher):
    await mark(client, dispatcher, prefer="late")
    wf = await latest_noshow(client, dispatcher)
    ap = pending(wf)
    if ap is None:
        assert wf["status"] == "informational"
        return
    assert "resequence" in ap["options"]["modes"]
    await decide(client, dispatcher, ap["id"], "override", override={"mode": "resequence"}, note="Protect on-time")
    wf = await latest_noshow(client, dispatcher)
    rec = wf["context"]["recovery"]
    assert rec["mode"] == "resequence"
    assert rec["late_after"] <= rec["late_before"]
    assert rec["pickups_moved"] >= 1


async def test_reject_keeps_schedule(client, dispatcher):
    await mark(client, dispatcher, prefer="standby")
    wf = await latest_noshow(client, dispatcher)
    ap = pending(wf)
    await decide(client, dispatcher, ap["id"], "reject", note="Driver already rerouting")
    wf = await latest_noshow(client, dispatcher)
    assert wf["status"] == "rejected"
    assert wf["context"]["recovery"]["mode"] == "rejected"


async def test_late_cancellation_and_duplicate_event(client, dispatcher):
    m = await mark(client, dispatcher, kind="late_cancel")
    wf = await latest_noshow(client, dispatcher)
    assert wf["context"]["assessment"]["kind"] == "late_cancel"
    ev = {"type": "trip.cancelled", "source": "trip_mgmt", "tenantid": "ten_mvt", "dedupekey": f"noshow:{m['trip_id']}",
          "data": {"trip_id": m["trip_id"], "run_id": m["run_id"], "kind": "late_cancel"}}
    r = await client.post("/api/events/ingest", json=ev, headers={"X-Ingest-Key": "local-ingest-key"})
    assert r.json()["status"] == "duplicate"


async def test_booking_failure_is_compensated(client, dispatcher, admin):
    await client.post("/api/simulator/failures", json={"target": "trip_mgmt.book_request", "mode": "fail_always"}, headers=admin)
    try:
        await mark(client, dispatcher, prefer="standby")
        wf = await latest_noshow(client, dispatcher)
        await decide(client, dispatcher, pending(wf)["id"])
    finally:
        await client.post("/api/simulator/failures", json={"target": "trip_mgmt.book_request", "mode": "off"}, headers=admin)
    wf = await latest_noshow(client, dispatcher)
    assert wf["status"] == "compensated"
    assert pending(wf, "escalation") is not None


async def test_autonomous_policy_runs_without_clicks(client):
    admin = await login(client, "admin@lsp.demo")
    disp = await login(client, "dispatcher@lsp.demo")
    pol = (await client.get("/api/policies/no_show_recovery", headers=admin)).json()
    assert [s["key"] for s in pol["meta"]["steps"]][2] == "adjust_schedule"
    rules = copy.deepcopy(pol["rules"])
    rules["steps"]["adjust_schedule"]["level"] = "autonomous"
    assert (await client.put("/api/policies/no_show_recovery", json={"rules": rules}, headers=admin)).status_code == 200
    try:
        await mark(client, disp, prefer="standby")
        wf = await latest_noshow(client, disp)
        assert pending(wf) is None
        assert wf["status"] in ("completed", "informational")
        assert wf["human_touches"] == 0
    finally:
        await client.put("/api/policies/no_show_recovery", json={"rules": pol["rules"]}, headers=admin)
    m = (await client.get("/api/metrics/summary", headers=disp)).json()
    assert m["no_show"]["orchestrations"] >= 1
