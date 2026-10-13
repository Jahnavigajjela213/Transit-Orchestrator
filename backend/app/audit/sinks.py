"""Audit mirrors. The orchestrator database is always the system of record; a mirror copies each record to
the analytics store (JSONL shaped like the Delta table, or the Databricks Delta table itself).

Records reach a mirror through the audit outbox (audit/shipper.py): written in the same transaction as the
audit record, shipped in batches, retried with backoff, so a Databricks outage never loses a record.
Mirrors raise on failure so the shipper knows to retry.
"""
import asyncio
import json
from abc import ABC, abstractmethod
from pathlib import Path

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger("audit.sink")


class AuditMirror(ABC):
    enabled = True

    @abstractmethod
    async def write_batch(self, records: list[dict]) -> None: ...

    async def write(self, record: dict) -> None:
        await self.write_batch([record])


class NoopMirror(AuditMirror):
    enabled = False

    async def write_batch(self, records: list[dict]) -> None:
        return None


class JsonlMirror(AuditMirror):
    """One JSON object per line; load into Databricks with COPY INTO / Auto Loader."""

    def __init__(self, path: str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = asyncio.Lock()

    async def write_batch(self, records: list[dict]) -> None:
        lines = "".join(json.dumps(r, default=str) + "\n" for r in records)
        async with self._lock:
            await asyncio.to_thread(self._append, lines)

    def _append(self, lines: str) -> None:
        with self.path.open("a", encoding="utf-8") as f:
            f.write(lines)


class DatabricksMirror(AuditMirror):
    """Inserts into a Delta table via databricks-sql-connector (requirements-optional.txt)."""

    COLUMNS = [
        "id", "tenant_id", "workflow_id", "step", "record_type", "triggering_event_id", "actor", "actor_type",
        "autonomy_level", "data_considered", "model_used", "recommendation", "human_action", "outcome",
        "explanation", "trace_id", "input_tokens", "output_tokens", "created_at",
    ]

    DDL = """CREATE TABLE IF NOT EXISTS {table} (
  id STRING, tenant_id STRING, workflow_id STRING, step STRING, record_type STRING, triggering_event_id STRING,
  actor STRING, actor_type STRING, autonomy_level STRING, data_considered STRING, model_used STRING, recommendation STRING,
  human_action STRING, outcome STRING, explanation STRING, trace_id STRING, input_tokens INT, output_tokens INT,
  created_at TIMESTAMP) USING DELTA PARTITIONED BY (tenant_id)"""

    async def write_batch(self, records: list[dict]) -> None:
        await asyncio.to_thread(self._insert, records)

    def _insert(self, records: list[dict]) -> None:
        from databricks import sql  # type: ignore  (requirements-optional.txt)

        params: list = []
        for r in records:
            params += [json.dumps(r.get(c), default=str) if isinstance(r.get(c), (dict, list)) else r.get(c) for c in self.COLUMNS]
        # created_at arrives as an ISO string from the outbox payload; cast it so the TIMESTAMP column accepts it
        row = "(" + ", ".join("CAST(? AS TIMESTAMP)" if c == "created_at" else "?" for c in self.COLUMNS) + ")"
        source = f"SELECT * FROM VALUES {', '.join([row] * len(records))} AS v({', '.join(self.COLUMNS)})"
        with sql.connect(server_hostname=settings.databricks_host or settings.databricks_server_hostname,
                         http_path=settings.databricks_http_path, access_token=settings.databricks_token) as conn, conn.cursor() as cur:
            if not getattr(self, "_table_ready", False):
                cur.execute(self.DDL.format(table=settings.databricks_audit_table))
                self._table_ready = True
            # One MERGE per batch, on id: a batch retried after a partial failure never inserts a record twice.
            cur.execute(f"MERGE INTO {settings.databricks_audit_table} t USING ({source}) s "
                        "ON t.id = s.id WHEN NOT MATCHED THEN INSERT *", params)


def build_mirror() -> AuditMirror:
    if settings.audit_mirror == "jsonl":
        return JsonlMirror(settings.audit_jsonl_path)
    if settings.audit_mirror == "databricks":
        return DatabricksMirror()
    return NoopMirror()


mirror = build_mirror()
