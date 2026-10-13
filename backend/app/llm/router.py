"""Model routing, token budgets, usage tracking and safe fallback.

- Each task maps to a tier (fast or smart), so cheap tasks use cheap models.
- Each tenant has a daily token budget; once spent, the deterministic mock takes over.
- Any provider error falls back to the mock so a workflow never stalls on the model.
"""
import json
from datetime import datetime, time as dtime
from typing import Optional

from sqlalchemy import func, select

from app.core.clock import new_id, now
from app.core.config import settings
from app.core.database import session_scope
from app.core.logging import get_logger
from app.llm.providers import LLMProvider, LLMResult, MockProvider
from app.models import LLMUsage

log = get_logger("llm")

TASK_TIERS = {"assess": "fast", "assess_noshow": "fast", "explain_step": "fast", "assistant": "smart", "slm_answer": "slm"}
# Estimated USD per million tokens (input, output). Update to your contract rates.
PRICES = {"fast": (1.0, 5.0), "smart": (3.0, 15.0), "slm": (0.0, 0.0)}

SYSTEM_PROMPTS = {
    "assess": (
        "You are the orchestration agent for a transit agency. You receive a vehicle fault, the runs it affects, and "
        "candidate spare vehicles and drivers that already passed hard constraints. Explain the situation for a dispatcher "
        "in plain language, at most 5 sentences. You may suggest a different candidate only from the options given. "
        'Return JSON: {"summary": str, "rationale": str, "confidence": number 0-1, '
        '"assignment_overrides": [{"run_id": str, "vehicle_id": str, "driver_id": str}]}'
    ),
    "assess_noshow": (
        "You are the orchestration agent for a paratransit operation. A rider no-showed or cancelled late. Using only the "
        "facts given, explain in at most 4 plain sentences what was freed and what you recommend (book a standby rider, "
        "move later pickups earlier, or hold) and why."
    ),
    "slm_answer": (
        "You are the Operator Performance assistant for one transit agency. Answer using ONLY the facts in the JSON "
        "(the agency's own history and the model's what-if results). Quote numbers exactly, name routes and levers, "
        "say what each lever is expected to add in percentage points, and say plainly if the target is not reachable "
        "with the levers given. No invented data. Under 180 words, plain language, short paragraphs or a short list."
    ),
    "explain_step": "Explain in 2-3 plain sentences what this proposed action does and why, for a busy dispatcher. No preamble.",
    "assistant": (
        "You are the TransitTechOS assistant. Answer questions about what the orchestrator did and why, using only the "
        "workflow record and audit trail provided. Name who approved what and when. If the record does not answer the "
        "question, say so. Keep it under 120 words."
    ),
}


def _build_provider(name: str | None = None) -> LLMProvider:
    name = name or settings.llm_provider
    try:
        if name == "ollama":
            from app.llm.providers import OllamaProvider

            return OllamaProvider()
        if name == "anthropic" and settings.anthropic_api_key:
            from app.llm.providers import AnthropicProvider

            return AnthropicProvider()
        if name == "bedrock":
            from app.llm.providers import BedrockProvider

            return BedrockProvider()
    except Exception:
        log.exception("Could not start LLM provider %s; using mock", name)
    return MockProvider()


class LLMRouter:
    def __init__(self) -> None:
        self.primary = _build_provider()
        self.slm = _build_provider(settings.slm_provider)
        self.mock = MockProvider()

    async def tokens_used_today(self, tenant_id: str) -> int:
        start = datetime.combine(now().date(), dtime.min)
        async with session_scope() as s:
            total = (
                await s.execute(
                    select(func.coalesce(func.sum(LLMUsage.input_tokens + LLMUsage.output_tokens), 0)).where(
                        LLMUsage.tenant_id == tenant_id, LLMUsage.created_at >= start, LLMUsage.provider != "mock"
                    )
                )
            ).scalar_one()
        return int(total)

    async def run(self, task: str, context: dict, *, tenant_id: str, workflow_id: Optional[str] = None) -> LLMResult:
        tier = TASK_TIERS.get(task, "fast")
        system = SYSTEM_PROMPTS.get(task, "")
        prompt = json.dumps(context, default=str, indent=1)
        want_json = task == "assess"
        provider = self.slm if task == "slm_answer" else self.primary
        fallback = False
        if provider.name not in ("mock", "ollama") and await self.tokens_used_today(tenant_id) >= settings.llm_daily_token_budget:
            log.warning("tenant %s hit its daily token budget; using mock provider", tenant_id)
            provider, fallback = self.mock, True
        try:
            result = await provider.complete(tier=tier, system=system, prompt=prompt, want_json=want_json, task=task, context=context)
            if want_json and result.data is None and provider.name != "mock":
                raise ValueError("model did not return valid JSON")
        except Exception:
            log.exception("LLM call failed on %s; falling back to mock", provider.name)
            result = await self.mock.complete(tier=tier, system=system, prompt=prompt, want_json=want_json, task=task, context=context)
            fallback = True
        result.fallback = fallback
        pin, pout = PRICES.get(tier, (0.0, 0.0))
        cost = 0.0 if result.provider in ("mock", "ollama") else (result.input_tokens * pin + result.output_tokens * pout) / 1_000_000
        async with session_scope() as s:
            s.add(LLMUsage(id=new_id("llm"), tenant_id=tenant_id, workflow_id=workflow_id, task=task, provider=result.provider,
                           model=result.model, input_tokens=result.input_tokens, output_tokens=result.output_tokens,
                           cost_usd=round(cost, 6), latency_ms=result.latency_ms, fallback=fallback, created_at=now()))
        return result


llm = LLMRouter()
