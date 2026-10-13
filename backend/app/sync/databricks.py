"""Keeps the Databricks copies of the product tables current (DATABRICKS_SYNC=true).

Postgres triggers on each product table record the primary key of every inserted, updated or deleted row in
databricks_sync_outbox. A background loop then:
  1. fully copies any table with no row in databricks_sync_state (first start, or after a demo reset), and
  2. drains the outbox: reads the *current* row for each changed key and upserts it into Databricks with MERGE, or deletes
     it there when it no longer exists in Postgres. Reading the current row (not the one captured at change time) makes
     replays harmless, so an outbox entry is only removed after its batch reached Databricks.
Every batch that lands publishes a live "sync" message, so open pages reload from Databricks.
The audit log is not synced here: app/audit/sinks.py mirrors it. A full copy only back-fills audit records missing in
Databricks and never removes rows there.
"""
import asyncio
import json
from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import delete, func, select, text

from app.core.config import settings
from app.core.database import engine, session_scope
from app.core.databricks import AUDIT_TABLE, SYNCED_TABLES, connect, qualified
from app.core.logging import get_logger
from app.core.realtime import hub
from app.models import DatabricksSyncOutbox, DatabricksSyncState

log = get_logger("sync.databricks")
BATCH_ROWS = 400  # rows per INSERT/MERGE statement
OUTBOX_BATCH = 2000

TYPES = {
    "character varying": "STRING", "text": "STRING", "json": "STRING", "jsonb": "STRING",
    "integer": "INT", "bigint": "BIGINT", "smallint": "SMALLINT", "double precision": "DOUBLE", "real": "FLOAT",
    "boolean": "BOOLEAN", "date": "DATE", "timestamp without time zone": "TIMESTAMP", "timestamp with time zone": "TIMESTAMP",
}


def lit(v: Any) -> str:
    """Spark SQL literal. Note '' is NOT an escaped quote in Spark SQL (it concatenates literals): use backslashes."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, datetime):
        return f"TIMESTAMP'{v.replace(tzinfo=None).isoformat(sep=' ')}'"
    if isinstance(v, date):
        return f"DATE'{v.isoformat()}'"
    if isinstance(v, (dict, list)):
        v = json.dumps(v, default=str)
    s = str(v).replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "\\r")
    return f"'{s}'"


# ---------------------------------------------------------------- triggers (Postgres)
CAPTURE_FN = """
CREATE OR REPLACE FUNCTION databricks_sync_capture() RETURNS trigger AS $$
DECLARE
  newk text; oldk text;
BEGIN
  IF TG_OP <> 'DELETE' THEN newk := to_jsonb(NEW) ->> TG_ARGV[0]; END IF;
  IF TG_OP <> 'INSERT' THEN oldk := to_jsonb(OLD) ->> TG_ARGV[0]; END IF;
  IF newk IS NOT NULL THEN
    INSERT INTO databricks_sync_outbox (table_name, pk, created_at) VALUES (TG_TABLE_NAME, newk, now());
  END IF;
  IF oldk IS NOT NULL AND oldk IS DISTINCT FROM newk THEN
    INSERT INTO databricks_sync_outbox (table_name, pk, created_at) VALUES (TG_TABLE_NAME, oldk, now());
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql"""


async def install_triggers() -> None:
    """Create (or, with DATABRICKS_SYNC off, remove) the change-capture triggers. Run after create_all()."""
    if not settings.database_url.startswith("postgresql"):
        return
    async with engine.begin() as conn:
        if settings.databricks_sync:
            await conn.execute(text(CAPTURE_FN))
        for t in SYNCED_TABLES:
            await conn.execute(text(f'DROP TRIGGER IF EXISTS databricks_sync ON "{t}"'))
            if settings.databricks_sync:
                pk = (await _columns(conn, t))[1]
                await conn.execute(text(f'CREATE TRIGGER databricks_sync AFTER INSERT OR UPDATE OR DELETE ON "{t}" '
                                        f"FOR EACH ROW EXECUTE FUNCTION databricks_sync_capture('{pk}')"))


_meta: dict[str, tuple[list[tuple[str, str]], str]] = {}


async def _columns(conn, table: str) -> tuple[list[tuple[str, str]], str]:
    """[(column, Databricks type)], primary key column."""
    if table not in _meta:
        cols = (await conn.execute(text("SELECT column_name, data_type FROM information_schema.columns "
                                        "WHERE table_schema = 'public' AND table_name = :t ORDER BY ordinal_position"), {"t": table})).all()
        pk = (await conn.execute(text("SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid "
                                      "AND a.attnum = ANY(i.indkey) WHERE i.indrelid = CAST(:t AS regclass) AND i.indisprimary"),
                                 {"t": table})).scalar_one()
        _meta[table] = ([(c, TYPES[d]) for c, d in cols], pk)
    return _meta[table]


# ---------------------------------------------------------------- Databricks statements
def _values(rows: list[dict], cols: list[tuple[str, str]]) -> str:
    return ",\n".join("(" + ", ".join(lit(r[c]) for c, _ in cols) + ")" for r in rows)


def _ddl(table: str, cols: list[tuple[str, str]]) -> str:
    return ", ".join(f"`{c}` {t}" for c, t in cols)


def _full_copy(table: str, cols: list[tuple[str, str]], pk: str, rows: list[dict]) -> None:
    """Atomic replace: load a staging table, then swap it in with one CREATE OR REPLACE (readers never see it half-full)."""
    target, stage = qualified(table), qualified(f"{table}__sync_stage")
    names = ", ".join(f"`{c}`" for c, _ in cols)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(f"CREATE OR REPLACE TABLE {stage} ({_ddl(table, cols)}) USING DELTA")
        for i in range(0, len(rows), BATCH_ROWS):
            cur.execute(f"INSERT INTO {stage} ({names}) VALUES\n{_values(rows[i:i + BATCH_ROWS], cols)}")
        if table == AUDIT_TABLE:  # back-fill only: never drop audit rows that exist only in Databricks
            cur.execute(f"CREATE TABLE IF NOT EXISTS {target} ({_ddl(table, cols)}) USING DELTA")
            cur.execute(f"MERGE INTO {target} t USING {stage} s ON t.`{pk}` = s.`{pk}` WHEN NOT MATCHED THEN INSERT *")
        else:
            cur.execute(f"CREATE OR REPLACE TABLE {target} USING DELTA AS SELECT * FROM {stage}")
        cur.execute(f"DROP TABLE IF EXISTS {stage}")


def _apply_changes(table: str, cols: list[tuple[str, str]], pk: str, upserts: list[dict], deleted: list[str]) -> None:
    target = qualified(table)
    names = ", ".join(c for c, _ in cols)
    with connect() as conn, conn.cursor() as cur:
        for i in range(0, len(upserts), BATCH_ROWS):
            cur.execute(f"MERGE INTO {target} t USING (SELECT * FROM VALUES {_values(upserts[i:i + BATCH_ROWS], cols)} AS v({names})) s "
                        f"ON t.`{pk}` = s.`{pk}` WHEN MATCHED THEN UPDATE SET * WHEN NOT MATCHED THEN INSERT *")
        for i in range(0, len(deleted), BATCH_ROWS):
            cur.execute(f"DELETE FROM {target} WHERE `{pk}` IN ({', '.join(lit(k) for k in deleted[i:i + BATCH_ROWS])})")


# ---------------------------------------------------------------- the loop
async def _rows(table: str, pk: str, keys: Optional[list[str]] = None) -> list[dict]:
    async with engine.connect() as conn:
        if keys is None:
            res = await conn.execute(text(f'SELECT * FROM "{table}" ORDER BY "{pk}"'))
        else:
            res = await conn.execute(text(f'SELECT * FROM "{table}" WHERE CAST("{pk}" AS text) = ANY(:keys)'), {"keys": keys})
        return [dict(r._mapping) for r in res]


def _announce(tenants: set[str], tables: list[str]) -> None:
    for tid in tenants:
        hub.publish(tid, "sync", {"tables": tables})


async def _all_tenants() -> set[str]:
    async with engine.connect() as conn:
        return {r[0] for r in await conn.execute(text("SELECT id FROM tenants"))}


async def full_sync_due() -> int:
    """Copy every table that has no sync state. Returns how many tables were copied."""
    async with session_scope() as s:
        done = set((await s.execute(select(DatabricksSyncState.table_name))).scalars())
        start_id = (await s.execute(select(func.coalesce(func.max(DatabricksSyncOutbox.id), 0)))).scalar_one()
    due = [t for t in SYNCED_TABLES + (AUDIT_TABLE,) if t not in done]
    for t in due:
        async with engine.connect() as conn:
            cols, pk = await _columns(conn, t)
        rows = await _rows(t, pk)
        await asyncio.to_thread(_full_copy, t, cols, pk, rows)
        async with session_scope() as s:
            # changes captured before this copy started are in it; later ones are replayed by the outbox
            await s.execute(delete(DatabricksSyncOutbox).where(DatabricksSyncOutbox.table_name == t, DatabricksSyncOutbox.id <= start_id))
            await s.merge(DatabricksSyncState(table_name=t, rows=len(rows)))
        log.info("Databricks: copied %s (%d rows) to %s", t, len(rows), qualified(t))
    if due:
        _announce(await _all_tenants(), due)
    return len(due)


async def drain_outbox() -> int:
    """Copy changed rows to Databricks. Returns how many outbox entries were applied."""
    async with session_scope() as s:
        batch = (await s.execute(select(DatabricksSyncOutbox).order_by(DatabricksSyncOutbox.id).limit(OUTBOX_BATCH))).scalars().all()
    if not batch:
        return 0
    by_table: dict[str, set[str]] = {}
    for e in batch:
        by_table.setdefault(e.table_name, set()).add(e.pk)
    tenants: set[str] = set()
    for t, keys in by_table.items():
        async with engine.connect() as conn:
            cols, pk = await _columns(conn, t)
        current = await _rows(t, pk, sorted(keys))
        present = {str(r[pk]) for r in current}
        tenants |= {r["tenant_id"] for r in current if r.get("tenant_id")}
        await asyncio.to_thread(_apply_changes, t, cols, pk, current, sorted(keys - present))
    async with session_scope() as s:
        await s.execute(delete(DatabricksSyncOutbox).where(DatabricksSyncOutbox.id <= batch[-1].id))
    _announce(tenants or await _all_tenants(), sorted(by_table))
    return len(batch)


class DatabricksSync:
    def __init__(self) -> None:
        self._task: Optional[asyncio.Task] = None
        self.last_error: Optional[str] = None
        self.last_synced_at: Optional[datetime] = None

    def start(self) -> None:
        if settings.databricks_sync and not self._task:
            self._task = asyncio.create_task(self._loop(), name="databricks-sync")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None

    async def _loop(self) -> None:
        delay = settings.databricks_sync_interval_seconds
        while True:
            try:
                n = await full_sync_due() + await drain_outbox()
                if n:
                    self.last_synced_at = datetime.now()
                self.last_error, delay = None, settings.databricks_sync_interval_seconds
            except Exception as e:  # noqa: BLE001  keep the outbox; retry with backoff
                self.last_error = f"{type(e).__name__}: {e}"[:500]
                delay = min(300.0, delay * 2)
                log.warning("Databricks sync failed, retrying in %.0fs: %s", delay, self.last_error)
            await asyncio.sleep(delay)


sync = DatabricksSync()
