"""Cross-cutting protection for every write action: permission check, idempotency,
rate limiting and retries with exponential backoff."""
import asyncio
import time
from typing import Any, Awaitable, Callable

from app.adapters.base import ActionContext
from app.core.clock import now
from app.core.config import settings
from app.core.database import session_scope
from app.core.errors import PolicyViolation, ProductAPIError
from app.core.logging import get_logger
from app.core.tracing import span
from app.models import IdempotencyRecord

log = get_logger("adapters")


class TokenBucket:
    def __init__(self, rate: float, capacity: float | None = None):
        self.rate = rate
        self.capacity = capacity or max(1.0, rate)
        self.tokens = self.capacity
        self.updated = time.monotonic()
        self._lock = asyncio.Lock()

    async def take(self) -> None:
        async with self._lock:
            while True:
                t = time.monotonic()
                self.tokens = min(self.capacity, self.tokens + (t - self.updated) * self.rate)
                self.updated = t
                if self.tokens >= 1:
                    self.tokens -= 1
                    return
                await asyncio.sleep((1 - self.tokens) / self.rate)


_buckets: dict[str, TokenBucket] = {}


def _bucket(system: str) -> TokenBucket:
    if system not in _buckets:
        _buckets[system] = TokenBucket(settings.adapter_rate_limit_per_second)
    return _buckets[system]


async def protected_write(
    ctx: ActionContext, system: str, action: str, idempotency_key: str, fn: Callable[[], Awaitable[Any]],
    *, backoff_base: float = 0.2,
) -> Any:
    full_action = f"{system}.{action}"
    if full_action not in ctx.allowed_actions and "*" not in ctx.allowed_actions:
        raise PolicyViolation(f"{ctx.actor} is not permitted to perform {full_action}")

    async with session_scope() as s:
        prior = await s.get(IdempotencyRecord, idempotency_key)
        if prior:
            log.info("idempotent replay %s (%s)", full_action, idempotency_key)
            return prior.result

    attempt = 0
    while True:
        attempt += 1
        await _bucket(system).take()
        try:
            with span(f"adapter.{full_action}", trace_id=ctx.trace_id, tenant=ctx.tenant_id, workflow=ctx.workflow_id, attempt=attempt):
                result = await fn()
            break
        except ProductAPIError as e:
            if e.transient and attempt < settings.adapter_max_retries:
                delay = backoff_base * (2 ** (attempt - 1))
                log.warning("%s transient failure (attempt %d), retrying in %.1fs: %s", full_action, attempt, delay, e.message)
                await asyncio.sleep(delay)
                continue
            raise

    async with session_scope() as s:
        if not await s.get(IdempotencyRecord, idempotency_key):
            s.add(IdempotencyRecord(key=idempotency_key, tenant_id=ctx.tenant_id, action=full_action, result=result, created_at=now()))
    return result
