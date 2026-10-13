"""Ships the audit outbox to the mirror (JSONL or the Databricks Delta table) in batches, with retries.

Each audit record and its outbox row are written in one transaction, so a record can never be lost between the
orchestrator database and Databricks. A failed batch is retried with exponential backoff (5 s up to 10 min);
after MAX_ATTEMPTS it is marked failed and shows on the Overview, and `retry_failed` puts it back in the queue.
"""
import asyncio
from datetime import timedelta
from typing import Optional

from sqlalchemy import func, select, update

from app.audit.sinks import mirror
from app.core.clock import now, precise_now
from app.core.config import settings
from app.core.database import session_scope
from app.core.logging import get_logger
from app.models import AuditOutbox

log = get_logger("audit.shipper")
MAX_ATTEMPTS = 12


class AuditShipper:
    def __init__(self) -> None:
        self._task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()

    def start(self) -> None:
        if mirror.enabled and not self._task:
            self._task = asyncio.create_task(self._loop(), name="audit-shipper")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None
        await self.flush()  # best effort on shutdown

    async def _loop(self) -> None:
        while True:
            try:
                await self.flush()
            except Exception:
                log.exception("audit shipping round failed")
            await asyncio.sleep(settings.audit_ship_interval_seconds)

    async def flush(self) -> int:
        """Ship everything that is due. Returns how many records were shipped."""
        if not mirror.enabled:
            return 0
        shipped = 0
        async with self._lock:
            while True:
                async with session_scope() as s:
                    batch = (await s.execute(select(AuditOutbox).where(AuditOutbox.status == "pending", AuditOutbox.next_attempt_at <= precise_now())
                                             .order_by(AuditOutbox.created_at).limit(settings.audit_ship_batch_size))).scalars().all()
                    if not batch:
                        return shipped
                    try:
                        await mirror.write_batch([b.payload for b in batch])
                    except Exception as e:  # noqa: BLE001
                        for b in batch:
                            b.attempts += 1
                            b.last_error = f"{type(e).__name__}: {e}"[:500]
                            b.next_attempt_at = now() + timedelta(seconds=min(600, 5 * 2 ** (b.attempts - 1)))
                            if b.attempts >= MAX_ATTEMPTS:
                                b.status = "failed"
                        log.warning("audit mirror write failed for %d record(s), will retry: %s", len(batch), e)
                        return shipped
                    t = now()
                    for b in batch:
                        b.status, b.sent_at, b.attempts = "sent", t, b.attempts + 1
                    shipped += len(batch)

    async def status(self, tenant_id: Optional[str] = None) -> dict:
        async with session_scope() as s:
            q = select(AuditOutbox.status, func.count(), func.min(AuditOutbox.created_at)).group_by(AuditOutbox.status)
            if tenant_id:
                q = q.where(AuditOutbox.tenant_id == tenant_id)
            rows = (await s.execute(q)).all()
            last_error = (await s.execute(select(AuditOutbox.last_error).where(AuditOutbox.last_error.is_not(None), AuditOutbox.status != "sent")
                                          .order_by(AuditOutbox.next_attempt_at.desc()).limit(1))).scalar_one_or_none()
        counts = {st: n for st, n, _ in rows}
        oldest = next((o for st, _, o in rows if st == "pending"), None)
        return {"mirror": settings.audit_mirror, "pending": counts.get("pending", 0), "sent": counts.get("sent", 0), "failed": counts.get("failed", 0),
                "oldest_pending_at": oldest, "lag_seconds": int((now() - oldest).total_seconds()) if oldest else 0, "last_error": last_error}

    async def retry_failed(self, tenant_id: Optional[str] = None) -> int:
        async with session_scope() as s:
            q = update(AuditOutbox).where(AuditOutbox.status == "failed").values(status="pending", attempts=0, next_attempt_at=now())
            if tenant_id:
                q = q.where(AuditOutbox.tenant_id == tenant_id)
            res = await s.execute(q)
            return res.rowcount or 0


shipper = AuditShipper()
