"""LLM providers. The mock provider is deterministic so the whole system runs offline."""
import asyncio
import json
import re
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Optional

from app.core.config import settings


@dataclass
class LLMResult:
    text: str
    data: Optional[dict]
    provider: str
    model: str
    input_tokens: int
    output_tokens: int
    latency_ms: int
    fallback: bool = False


def _parse_json(text: str) -> Optional[dict]:
    cleaned = re.sub(r"```(?:json)?|```", "", text).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end == -1:
        return None
    try:
        return json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return None


class LLMProvider(ABC):
    name: str

    @abstractmethod
    def model_for(self, tier: str) -> str: ...

    @abstractmethod
    async def complete(self, *, tier: str, system: str, prompt: str, want_json: bool, task: str, context: dict) -> LLMResult: ...


class MockProvider(LLMProvider):
    """Template-based reasoning over the structured context. No network, no key."""

    name = "mock"

    def model_for(self, tier: str) -> str:
        return f"mock-{tier}"

    async def complete(self, *, tier, system, prompt, want_json, task, context) -> LLMResult:
        t0 = time.perf_counter()
        handler = getattr(self, f"_task_{task}", self._task_default)
        text, data = handler(context)
        return LLMResult(
            text=text, data=data, provider=self.name, model=self.model_for(tier),
            input_tokens=max(1, (len(system) + len(prompt)) // 4), output_tokens=max(1, len(text) // 4),
            latency_ms=int((time.perf_counter() - t0) * 1000),
        )

    def _task_default(self, ctx: dict) -> tuple[str, Optional[dict]]:
        return "No additional analysis.", None

    def _task_assess(self, ctx: dict) -> tuple[str, Optional[dict]]:
        v, sev, fault = ctx["vehicle_label"], ctx["severity"], ctx["fault_description"]
        runs = ctx.get("runs_at_risk", [])
        props = ctx.get("proposals", [])
        uncovered = [p for p in props if not p.get("vehicle_id")]
        window = f"{ctx['out_of_service_from_h']} to {ctx['out_of_service_until_h']}"
        parts = [f"{v} reported {fault.lower()} ({ctx['trigger_code']}), rated {sev}."]
        if sev in ("critical", "high"):
            parts.append("Continuing service risks a road call or safety incident, so the vehicle should come out of service.")
        elif sev == "medium":
            parts.append("The vehicle can finish today's service; schedule shop time at the next open bay.")
        else:
            parts.append("This is low risk. Log it and fix it at the next planned maintenance visit.")
        parts.append(f"Recommended shop window: {window} at {ctx['depot']}.")
        if runs:
            parts.append(f"{len(runs)} run(s) fall inside that window, carrying {sum(r['riders'] for r in runs)} booked riders.")
            if uncovered:
                parts.append(f"No qualified spare was found for {len(uncovered)} run(s); those need a dispatcher decision.")
            else:
                parts.append("A spare vehicle and a qualified driver were found for every affected run.")
        else:
            parts.append("No scheduled runs are affected.")
        summary = " ".join(parts)
        return summary, {"summary": summary, "rationale": parts[1], "confidence": 0.9 if not uncovered else 0.7}

    def _task_assess_noshow(self, ctx: dict) -> tuple[str, Optional[dict]]:
        what = "did not show" if ctx["kind"] == "no_show" else "cancelled late"
        parts = [f"{ctx['rider']} {what} for the {ctx['pickup_time']} pickup on {ctx['route']} {ctx['block']} ({ctx['vehicle']}), freeing about {ctx['minutes_saved']} minutes."]
        parts.append(ctx["reason"])
        if ctx["mode"] == "insert" and ctx.get("candidate"):
            cnd = ctx["candidate"]
            parts.append(f"Best standby match: {cnd['rider_name']} ({cnd['purpose']} trip) from {cnd['pickup_stop']}, about {cnd['detour_min']} min of extra driving.")
        if ctx["moved"]:
            parts.append(f"{ctx['moved']} later pickup(s) would be re-timed; late pickups go from {ctx['late_before']} to {ctx['late_after']}.")
        if ctx.get("flag_rider"):
            parts.append(f"This rider has {ctx['rider_no_shows_30d']} no-shows in the last 30 days, which meets the review threshold.")
        return " ".join(parts), None

    def _task_slm_answer(self, ctx: dict) -> tuple[str, Optional[dict]]:
        from app.analytics.slm import compose_answer

        return compose_answer(ctx), None

    def _task_explain_step(self, ctx: dict) -> tuple[str, Optional[dict]]:
        step, v = ctx["step"], ctx["vehicle_label"]
        if step == "adjust_schedule":
            if ctx["mode"] == "insert" and ctx.get("candidate"):
                c = ctx["candidate"]
                text = (f"Book standby rider {c['rider_name']} ({c['purpose']}) into the seat freed on {ctx['route']}, pickup about "
                        f"{c['proposed_pickup'][11:16]} from {c['pickup_stop']}. Net effect on later pickups: {c['net_change_min']:+d} min.")
            else:
                text = (f"Use the {ctx['minutes_saved']} freed minutes on {ctx['route']} to move {ctx['moved']} later pickup(s) earlier; "
                        f"late pickups drop from {ctx['late_before']} to {ctx['late_after']}.")
            return text, None
        if step == "open_work_order":
            text = (f"Open a {ctx['priority']} work order for {v}: {ctx['title']}. Shop window {ctx['window']} at {ctx['depot']}. "
                    f"Based on fault {ctx['fault_code']} and {ctx['open_wos']} open work order(s) on this unit.")
        elif step == "pull_vehicle":
            text = (f"Mark {v} unavailable from {ctx['from']} to {ctx['until']} so the schedule stops assigning it. "
                    f"{ctx['run_count']} run(s) in that window will need cover.")
        elif step == "reassign_runs":
            lines = [f"{p['route_name']} {p['block_name']} ({p['start_h']}): {p.get('vehicle_label') or 'no spare'} with {p.get('driver_name') or 'no driver'}"
                     for p in ctx["proposals"]]
            text = "Proposed cover for each affected run. " + "; ".join(lines) + ". Spares chosen by depot, size, accessibility and current load."
        elif step == "notify_riders":
            text = f"Send updated ETAs to {ctx['rider_count']} rider(s) on {ctx['run_count']} reassigned run(s)."
        elif step == "return_to_service":
            text = f"Work order {ctx['work_order_id']} is closed. Put {v} back on the schedule."
        else:
            text = f"Proceed with {step} for {v}."
        return text, None

    def _task_assistant(self, ctx: dict) -> tuple[str, Optional[dict]]:
        wf = ctx.get("workflow")
        hits = ctx.get("retrieved") or []  # semantic search results, best first
        if not wf and not hits:
            return ("I could not find an orchestration for that question. Ask about a vehicle (for example, "
                    "\"Why was V-105 pulled?\") or open a workflow and ask from there."), None
        def clip(t: str) -> str:
            return t if len(t) <= 420 else t[:417].rsplit(" ", 1)[0] + "..."

        def words(v: Optional[str]) -> str:
            return (v or "").replace("_", " ")

        lines = []
        best = hits[0]["text"] if hits else ""
        if best:
            lines.append(clip(best))
        if not wf:
            return " ".join(lines), None
        label, _, issue = wf["title"].partition(": ")
        issue = issue or wf["title"]
        issue = issue if issue[1:2].isupper() else issue[:1].lower() + issue[1:]  # keep acronyms like "ABS"
        lines.append(f"{wf['vehicle_label'] or label} had {issue.rstrip('.')}.")
        if wf.get("summary") and wf["summary"] not in best:
            lines.append(wf["summary"])
        verbs = {"approved": "approved", "rejected": "rejected", "edited": "edited and approved"}
        for a in ctx.get("audit", []):
            at, step, why = a["created_at"][11:16], words(a.get("step")), (a.get("explanation") or "").strip()
            if why and why in best:
                continue  # already told above
            if a["record_type"] == "human_action":
                lines.append(f"At {at}, {a['actor']} {verbs.get(a.get('human_action'), words(a.get('human_action')))} the {step} step"
                             + (f", noting: {why.rstrip('.')}" if why else "") + ".")
            elif a["record_type"] == "action_executed":
                lines.append(f"At {at}, the {step} step went through: {why[:1].lower() + why[1:] if why else 'done.'}")
            elif a["record_type"] == "compensation":
                lines.append(f"At {at}, a step was rolled back: {why}")
            elif a["record_type"] == "action_failed":
                lines.append(f"At {at}, the {step} step failed: {why}")
        status = {"awaiting_event": "is now waiting for the next event, such as the work order being closed",
                  "awaiting_approval": "is now waiting for a person's approval", "completed": "has finished",
                  "shadow": "ran in shadow mode, so nothing was changed in the products", "running": "is still running",
                  "failed": "stopped with a failure"}.get(wf["status"], f"is now {words(wf['status'])}")
        lines.append(f"The orchestration {status}.")
        return " ".join(lines), None


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self):
        from anthropic import AsyncAnthropic

        self.client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    def model_for(self, tier: str) -> str:
        return settings.anthropic_model_smart if tier == "smart" else settings.anthropic_model_fast

    async def complete(self, *, tier, system, prompt, want_json, task, context) -> LLMResult:
        t0 = time.perf_counter()
        model = self.model_for(tier)
        resp = await self.client.messages.create(
            model=model, max_tokens=900, system=system,
            messages=[{"role": "user", "content": prompt + ("\n\nRespond with JSON only." if want_json else "")}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        return LLMResult(text=text, data=_parse_json(text) if want_json else None, provider=self.name, model=model,
                         input_tokens=resp.usage.input_tokens, output_tokens=resp.usage.output_tokens,
                         latency_ms=int((time.perf_counter() - t0) * 1000))


class OllamaProvider(LLMProvider):
    """A real small language model running locally (https://ollama.com). Used for the Operator Performance SLM and,
    with ASSISTANT_PROVIDER=ollama, for the assistant."""

    name = "ollama"

    def model_for(self, tier: str) -> str:
        return settings.ollama_model

    async def complete(self, *, tier, system, prompt, want_json, task, context) -> LLMResult:
        import httpx

        t0 = time.perf_counter()
        body = {"model": settings.ollama_model, "stream": False, "keep_alive": "30m",  # stay loaded between questions
                "options": {"temperature": 0.2, "num_ctx": 6144, "num_predict": 400},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]}
        if want_json:
            body["format"] = "json"
        async with httpx.AsyncClient(timeout=settings.ollama_timeout_seconds) as c:
            r = await c.post(f"{settings.ollama_base_url.rstrip('/')}/api/chat", json=body)
            r.raise_for_status()
            j = r.json()
        text = j.get("message", {}).get("content", "").strip()
        if not text:
            raise ValueError("Ollama returned an empty answer")
        return LLMResult(text=text, data=_parse_json(text) if want_json else None, provider=self.name, model=settings.ollama_model,
                         input_tokens=j.get("prompt_eval_count", 0), output_tokens=j.get("eval_count", 0),
                         latency_ms=int((time.perf_counter() - t0) * 1000))


class BedrockProvider(LLMProvider):
    name = "bedrock"

    def __init__(self):
        import boto3  # requirements-optional.txt

        self.client = boto3.client("bedrock-runtime", region_name=settings.aws_region)

    def model_for(self, tier: str) -> str:
        return settings.bedrock_model_smart if tier == "smart" else settings.bedrock_model_fast

    async def complete(self, *, tier, system, prompt, want_json, task, context) -> LLMResult:
        t0 = time.perf_counter()
        model = self.model_for(tier)

        def call() -> Any:
            return self.client.converse(
                modelId=model, system=[{"text": system}],
                messages=[{"role": "user", "content": [{"text": prompt + ("\n\nRespond with JSON only." if want_json else "")}]}],
                inferenceConfig={"maxTokens": 900},
            )

        resp = await asyncio.to_thread(call)
        text = "".join(c.get("text", "") for c in resp["output"]["message"]["content"])
        usage = resp.get("usage", {})
        return LLMResult(text=text, data=_parse_json(text) if want_json else None, provider=self.name, model=model,
                         input_tokens=usage.get("inputTokens", 0), output_tokens=usage.get("outputTokens", 0),
                         latency_ms=int((time.perf_counter() - t0) * 1000))
