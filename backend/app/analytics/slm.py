"""Operator Performance SLM: grounded question answering over one agency's history.

Pipeline per question:
  1. understand  - intent, target OTP, route, etc. from the question
  2. ground      - pull facts from the agency's history and the trained model (insights + what-if plan)
  3. generate    - the SLM (local Ollama model, or a cloud model, or the built-in composer) writes the
                   answer from those facts only
The same composer produces a chat-format fine-tuning dataset so a small model can be tuned on
the agency's own data in Databricks later.
"""
import json
import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics import insights as I
from app.analytics import model as M

SUGGESTED = [
    "How do we move OTP from {cur}% to {tgt}%?",
    "Why are pickups late on {route}?",
    "Which operators should we coach first?",
    "How much does rain hurt on-time performance?",
    "What is the OTP trend over the last few months?",
    "How much would cutting no-shows help?",
]


def understand(question: str, routes: list[str]) -> dict[str, Any]:
    q = question.lower()
    nums = [float(x) for x in re.findall(r"(\d{2}(?:\.\d+)?)\s*%", q)]
    if not nums:
        nums = [float(x) for x in re.findall(r"\b(?:to|reach|hit|target(?:ing)?|get to)\s+(\d{2}(?:\.\d+)?)\b", q)]
    route = None
    for r in sorted(routes, key=len, reverse=True):
        rl = r.lower()
        num = re.search(r"route (\d+)", rl)
        if rl in q or (num and re.search(rf"\broute\s*{num.group(1)}\b", q)):
            route = r
            break
    intent = "overview"
    if nums or re.search(r"\b(improve|increase|raise|boost|move otp|get otp|reach|lift)\b", q):
        intent = "plan"
    elif route:
        intent = "route"
    elif re.search(r"\b(drivers?|operators?|coach\w*|training|staff)\b", q):
        intent = "operators"
    elif re.search(r"no[- ]?shows?|cancel", q):
        intent = "no_shows"
    elif re.search(r"\b(rain\w*|weather|fog\w*|heat|storms?)\b", q):
        intent = "weather"
    elif re.search(r"\b(trend|over time|last (few )?months?|weekly|getting better|getting worse)\b", q):
        intent = "trend"
    elif re.search(r"\b(why|causes?|reasons?|factors?|late|worst)\b", q):
        intent = "causes"
    target = nums[-1] if nums else None
    return {"intent": intent, "target": target, "from": nums[0] if len(nums) > 1 else None, "route": route}


async def ground(s: AsyncSession, tenant_id: str, question: str) -> dict[str, Any]:
    rows = await M.load_history(s, tenant_id)
    pm = await M.active_model(s, tenant_id)
    if not rows or not pm:
        return {"error": "No trained model yet. Train the model on the Performance page first."}
    model = M.model_from_row(pm)
    summ = I.summary(rows)
    routes = [g["key"] for g in summ["by_route"]]
    u = understand(question, routes)
    facts: dict[str, Any] = {
        "question": question, "intent": u["intent"], "agency_history_days": summ["history_days"], "history_runs": summ["history_runs"],
        "known_routes": routes,
        "otp_30d": summ["otp_30d"], "otp_prior_30d": summ["otp_prior_30d"], "model_version": pm.version,
        "model_holdout_daily_error_pp": pm.metrics.get("holdout_daily_otp_mae_pp"),
        "top_factors": [{"factor": x["label"], "detail": x.get("worst") or x.get("direction")} for x in pm.params.get("importance", [])[:5]],
    }
    if u["intent"] in ("plan", "overview"):
        target = u["target"] or round((summ["otp_30d"] or 90) + 2, 1)
        p = I.plan(model, rows, target)
        facts["plan"] = {k: p[k] for k in ("current_otp", "target_otp", "reached", "projected_otp", "max_with_all_levers")}
        facts["plan_steps"] = [{k: st[k] for k in ("name", "detail", "uplift_pp", "cumulative_otp", "effort", "cost_note")} for st in p["plan"]]
        facts["stated_from"] = u["from"]
    if u["intent"] in ("route", "causes", "overview"):
        facts["worst_routes"] = summ["by_route"][:3]
    if u["intent"] == "route":
        facts["route"] = next((g for g in summ["by_route"] if g["key"] == u["route"]), None)
        facts["route_bands"] = I.group([r for r in I.window(rows, I.BASELINE_DAYS) if r["route_name"] == u["route"]], "hour_band")
        facts["fleet_avg_recovery_min"] = round(sum(g["recovery_min"] for g in summ["by_route"]) / len(summ["by_route"]), 1)
        facts["fleet_avg_dwell_min"] = round(sum(g["dwell_min"] for g in summ["by_route"]) / len(summ["by_route"]), 2)
    if u["intent"] in ("causes",):
        facts["by_band"] = summ["by_band"]
        facts["pm_effect"] = {"otp_when_pm_overdue": summ["otp_when_pm_overdue"], "otp_when_pm_current": summ["otp_when_pm_current"]}
    if u["intent"] == "operators":
        facts["by_tenure"] = summ["by_tenure"]
        facts["coaching_candidates"] = summ["coaching_candidates"][:5]
    if u["intent"] == "weather":
        facts["by_weather"] = summ["by_weather"]
    if u["intent"] == "trend":
        facts["weekly"] = summ["weekly"][-12:]
    if u["intent"] == "no_shows":
        p = I.plan(model, rows, 100.0)
        lv = next((x for x in p["levers"] if x["key"] == "no_show_reduction"), None)
        facts["no_shows"] = {"no_shows_30d": summ["no_shows_30d"], "late_cancels_30d": summ["late_cancels_30d"],
                             "no_show_rate_30d": summ["no_show_rate_30d"], "uplift_if_cut_30pct_pp": lv["uplift_pp"] if lv else 0.0}
    return facts


def _pct(x: Any) -> str:
    return f"{x:.1f}%" if isinstance(x, (int, float)) else "n/a"


def compose_answer(f: dict[str, Any]) -> str:
    """Deterministic SLM stand-in: writes the answer strictly from grounded facts."""
    if f.get("error"):
        return f["error"]
    it = f["intent"]
    head = f"Over the last 30 days OTP was {_pct(f['otp_30d'])} (prior 30 days {_pct(f['otp_prior_30d'])})."
    if it in ("plan", "overview"):
        p = f["plan"]
        lines = [head]
        if f.get("stated_from") and abs(f["stated_from"] - p["current_otp"]) > 0.5:
            lines.append(f"Note: your history shows {_pct(p['current_otp'])} today, not {f['stated_from']:.0f}%; the plan starts from the measured figure.")
        if p["current_otp"] >= p["target_otp"]:
            lines.append(f"You are already at or above {_pct(p['target_otp'])}.")
            return " ".join(lines)
        lines.append(f"To reach {_pct(p['target_otp'])}, the model ranks these levers by expected gain:")
        for i, st in enumerate(f["plan_steps"], 1):
            lines.append(f"{i}. {st['name']} ({st['detail']}): about +{st['uplift_pp']:.1f} pts, taking OTP to {_pct(st['cumulative_otp'])}. Effort {st['effort']}; {st['cost_note']}.")
        if p["reached"]:
            lines.append(f"Together these are projected to reach {_pct(p['projected_otp'])}.")
        else:
            lines.append(f"Even with every lever the model projects {_pct(p['max_with_all_levers'])}, short of {_pct(p['target_otp'])}; "
                         "the rest needs structural change (more vehicles or schedule redesign).")
        lines.append(f"Projections come from model v{f['model_version']} trained on {f['history_runs']:,} runs; its daily OTP error on the holdout is about {f['model_holdout_daily_error_pp']} pts.")
        return "\n".join(lines)
    if it == "route":
        r = f.get("route")
        if not r:
            return head + " I could not find that route in your history."
        bands = ", ".join(f"{b['key'].replace('_', ' ')} {_pct(b['otp'])}" for b in f["route_bands"])
        why = []
        if r["recovery_min"] < f["fleet_avg_recovery_min"] - 1:
            why.append(f"only {r['recovery_min']} min of recovery per block versus {f['fleet_avg_recovery_min']} across the system")
        if r["dwell_min"] > f["fleet_avg_dwell_min"] + 0.3:
            why.append(f"long dwell ({r['dwell_min']} min per stop versus {f['fleet_avg_dwell_min']})")
        if r["load_factor"] > 0.8:
            why.append(f"crowding (load factor {r['load_factor']})")
        if r["no_show_rate"] > 6:
            why.append(f"a {r['no_show_rate']}% no-show rate")
        return (f"{r['key']} ran {_pct(r['otp'])} on time over the last 30 days ({r['late_pickups']} late pickups across {r['runs']} runs, "
                f"{r['avg_late_min']} min late on average). By time of day: {bands}. "
                + (f"The data points to {', '.join(why)}." if why else "No single schedule factor stands out; lateness is spread across conditions."))
    if it == "operators":
        tb = ", ".join(f"{t['key']} {_pct(t['otp'])}" for t in f["by_tenure"])
        cands = "; ".join(f"{c['driver_name']} ({c['tenure_band']}, {_pct(c['otp'])} over {c['runs']} runs)" for c in f["coaching_candidates"])
        return f"{head} OTP by operator experience: {tb}. Lowest OTP over the last 60 days (min 15 runs): {cands}. Route mix matters, so pair coaching with a look at which routes they drive."
    if it == "weather":
        w = ", ".join(f"{x['key']} {_pct(x['otp'])} ({x['runs']} runs)" for x in f["by_weather"])
        return f"{head} By weather over the last 30 days: {w}. Weather is outside your control; recovery time on exposed routes is the usual hedge."
    if it == "trend":
        wk = f["weekly"]
        first, last = wk[0], wk[-1]
        best = max(wk, key=lambda x: x["otp"] or 0)
        worst = min(wk, key=lambda x: x["otp"] or 101)
        return (f"Weekly OTP went from {_pct(first['otp'])} (week of {first['week']}) to {_pct(last['otp'])} (week of {last['week']}). "
                f"Best week {best['week']} at {_pct(best['otp'])}, worst {worst['week']} at {_pct(worst['otp'])}.")
    if it == "no_shows":
        n = f["no_shows"]
        return (f"{head} There were {n['no_shows_30d']} no-shows and {n['late_cancels_30d']} late cancellations in 30 days, a {n['no_show_rate_30d']}% no-show rate. "
                f"Cutting no-shows by 30% is worth about +{n['uplift_if_cut_30pct_pp']:.1f} pts of OTP by the model, before counting seats reused for standby riders.")
    if it == "causes":
        bands = ", ".join(f"{b['key'].replace('_', ' ')} {_pct(b['otp'])}" for b in f["by_band"])
        worst = "; ".join(f"{r['key']} {_pct(r['otp'])}" for r in f["worst_routes"])
        factors = ", ".join(x["factor"].lower() + (f" ({x['detail']})" if x.get("detail") else "") for x in f["top_factors"])
        pmx = f["pm_effect"]
        return (f"{head} The strongest drivers of late pickups in the model are {factors}. By time of day: {bands}. Worst routes: {worst}. "
                f"Runs on vehicles overdue for maintenance ran {_pct(pmx['otp_when_pm_overdue'])} versus {_pct(pmx['otp_when_pm_current'])} otherwise.")
    return head


async def answer(s: AsyncSession, tenant_id: str, question: str) -> dict[str, Any]:
    from app.llm.router import llm

    facts = await ground(s, tenant_id, question)
    res = await llm.run("slm_answer", facts, tenant_id=tenant_id)
    return {"answer": res.text.strip(), "intent": facts.get("intent"), "facts": facts, "model": res.model, "provider": res.provider,
            "fallback": res.fallback}


async def suggestions(s: AsyncSession, tenant_id: str) -> list[str]:
    rows = await M.load_history(s, tenant_id, since=None)
    if not rows:
        return []
    summ = I.summary(rows)
    cur = summ["otp_30d"] or 90
    worst = summ["by_route"][0]["key"] if summ["by_route"] else "your latest route"
    return [q.format(cur=round(cur), tgt=round(cur) + 3, route=worst) for q in SUGGESTED]


async def training_dataset(s: AsyncSession, tenant_id: str) -> list[dict]:
    """Chat-format fine-tuning examples grounded in this agency's data (JSONL-ready)."""
    rows = await M.load_history(s, tenant_id)
    summ = I.summary(rows)
    cur = round(summ["otp_30d"] or 90)
    questions = [f"How do we move OTP from {cur}% to {cur + t}%?" for t in (1, 2, 3, 4)]
    questions += [f"Why are pickups late on {g['key']}?" for g in summ["by_route"]]
    questions += [f"How is {g['key']} performing in the afternoon peak?" for g in summ["by_route"][:4]]
    questions += ["Which operators should we coach first?", "How much does rain hurt on-time performance?",
                  "What is the OTP trend over the last few months?", "How much would cutting no-shows help?",
                  "What are the main causes of late pickups?", "Give me an overview of on-time performance."]
    system = ("You are the Operator Performance assistant for this transit agency. Answer only from the agency's own "
              "history; quote numbers; recommend levers with expected gains.")
    out = []
    for q in questions:
        facts = await ground(s, tenant_id, q)
        out.append({"messages": [{"role": "system", "content": system},
                                 {"role": "user", "content": q},
                                 {"role": "assistant", "content": compose_answer(facts)}],
                    "metadata": {"tenant_id": tenant_id, "intent": facts.get("intent"), "model_version": facts.get("model_version"),
                                 "facts": json.loads(json.dumps(facts, default=str))}})
    return out
