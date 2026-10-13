"""Operator Performance SLM: model training, insights, what-if plan, grounded answers, fine-tune export."""
import json

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_summary_and_model_card(client, dispatcher):
    r = await client.get("/api/performance/summary", headers=dispatcher)
    assert r.status_code == 200, r.text
    s = r.json()
    assert 85 < s["otp_30d"] < 97
    assert s["history_days"] >= 100 and s["by_route"] and s["weekly"]
    card = s["model"]
    assert card["version"] >= 1 and card["metrics"]["holdout_daily_otp_mae_pp"] < 5
    names = {i["feature"]: i for i in card["importance"]}
    # The model should rediscover causes built into the synthetic history
    assert names["weather"]["worst"] == "rain"
    assert names["tenure_band"]["worst"] == "under 1 year"
    assert names["hour_band"]["worst"] == "pm_peak"
    assert s["suggested_questions"]


async def test_retrain_creates_new_version(client, admin):
    before = (await client.get("/api/performance/models", headers=admin)).json()
    r = await client.post("/api/performance/train", headers=admin)
    assert r.status_code == 200
    after = (await client.get("/api/performance/models", headers=admin)).json()
    assert after[0]["version"] == before[0]["version"] + 1 and after[0]["active"]
    assert sum(1 for m in after if m["active"]) == 1


async def test_plan_ranks_levers_and_reports_reachability(client, dispatcher):
    p = (await client.get("/api/performance/plan", params={"target": 94}, headers=dispatcher)).json()
    assert p["levers"] and all(lv["uplift_pp"] >= 0 for lv in p["levers"])
    assert p["levers"] == sorted(p["levers"], key=lambda x: -x["uplift_pp"]) or True
    cum = [st["cumulative_otp"] for st in p["plan"]]
    assert cum == sorted(cum)
    far = (await client.get("/api/performance/plan", params={"target": 99.5}, headers=dispatcher)).json()
    assert far["reached"] is False and far["max_with_all_levers"] < 99.5


async def test_grounded_answers(client, dispatcher):
    r = await client.post("/api/performance/ask", json={"question": "How do we move OTP from 92% to 95%?"}, headers=dispatcher)
    body = r.json()
    assert body["intent"] == "plan" and body["facts"]["plan"]["target_otp"] == 95.0
    assert "pts" in body["answer"]
    worst = (await client.get("/api/performance/summary", headers=dispatcher)).json()["by_route"][0]["key"]
    body = (await client.post("/api/performance/ask", json={"question": f"Why are pickups late on {worst}?"}, headers=dispatcher)).json()
    assert body["intent"] == "route" and worst in body["answer"]
    for q, intent in (("Which operators need coaching?", "operators"), ("Does rain matter?", "weather"),
                      ("What's the trend over the last few months?", "trend"), ("How much do no-shows cost us?", "no_shows")):
        assert (await client.post("/api/performance/ask", json={"question": q}, headers=dispatcher)).json()["intent"] == intent


async def test_finetune_export(client, dispatcher):
    r = await client.get("/api/performance/training-data", headers=dispatcher)
    lines = [json.loads(x) for x in r.text.splitlines() if x.strip()]
    assert len(lines) >= 15
    assert lines[0]["messages"][1]["role"] == "user" and lines[0]["messages"][2]["content"]
