"""Request session for READ_SOURCE=databricks.

Queries that read only product/analytics tables (app/core/databricks.py) run on the Databricks SQL warehouse; queries on
orchestration tables (workflows, approvals, users, policies...) and every write run on Postgres. A query that mixes the
two cannot run in either place and is refused. A failed Databricks read becomes HTTP 502: there is no fallback.
Each request that read from Databricks prints one line in the server log: tables, rows, time, and any local Postgres reads.
"""
import asyncio
import sys
import time
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Table
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from sqlalchemy.sql import Select
from sqlalchemy.sql.util import find_tables

from app.core.config import settings
from app.core.databricks import DATABRICKS_TABLES, qualified, read_engine
from app.core.logging import get_logger

log = get_logger("data_source")
_COLOR = sys.stdout.isatty()


def _tag(text: str, code: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _COLOR else text


def _tables(stmt) -> set[str]:
    # real tables only: subqueries/aliases are walked into, so their underlying tables are counted too
    return {t.name for t in find_tables(stmt, include_joins=True, include_aliases=True) if isinstance(t, Table)}


class HybridSession:
    def __init__(self, pg: AsyncSession, label: str = "") -> None:
        self._pg = pg
        self._dbx: Session | None = None
        self._label = label  # e.g. "GET /api/fleet", for the log line
        self._dbx_reads = {"queries": 0, "rows": 0, "seconds": 0.0, "tables": set(), "failed": 0}
        self._pg_tables: set[str] = set()

    # ---- routing
    def _target(self, stmt) -> str:
        if not isinstance(stmt, Select):
            return "postgres"  # writes, text() and anything else stay on Postgres
        names = _tables(stmt)
        dbx, pg = names & DATABRICKS_TABLES, names - DATABRICKS_TABLES
        if dbx and pg:
            raise HTTPException(500, f"This query joins Databricks tables ({', '.join(sorted(dbx))}) with Postgres-only "
                                     f"tables ({', '.join(sorted(pg))}); split it into one query per source.")
        return "databricks" if dbx else "postgres"

    async def _on_databricks(self, fn, what: str, tables: set[str]):
        """`fn(session)` returns (result, rows read)."""
        def run():
            if self._dbx is None:
                self._dbx = Session(read_engine())
            return fn(self._dbx)

        stats = self._dbx_reads
        stats["queries"] += 1
        stats["tables"] |= tables
        t0 = time.perf_counter()
        try:
            result, rows = await asyncio.to_thread(run)
            stats["rows"] += rows
            return result
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001  no fallback to Postgres: report it
            stats["failed"] += 1
            if self._dbx is not None:
                self._dbx.rollback()
            raise HTTPException(502, f"Could not read {what} from Databricks: {type(e).__name__}: {str(e).splitlines()[0][:400]}")
        finally:
            stats["seconds"] += time.perf_counter() - t0

    def _report(self) -> None:
        """One line per request that touched Databricks, so it is visible where the data came from."""
        st = self._dbx_reads
        if not st["queries"]:
            return
        where = f"{settings.databricks_catalog}.{settings.databricks_schema}"
        line = (f"{_tag('[DATABRICKS]', '1;36')} {self._label}: {st['rows']} rows in {st['queries']} "
                f"quer{'y' if st['queries'] == 1 else 'ies'} ({st['seconds']:.2f} s) from {where}: {', '.join(sorted(st['tables']))}")
        if st["failed"]:
            line += _tag(f"  [{st['failed']} failed]", "1;31")
        if self._pg_tables:
            line += f"  | local Postgres (app data only): {', '.join(sorted(self._pg_tables))}"
        log.info(line)

    # ---- the AsyncSession surface the routes use
    async def execute(self, stmt, *args, **kwargs):
        if self._target(stmt) == "postgres":
            if isinstance(stmt, Select):
                self._pg_tables |= _tables(stmt)
            return await self._pg.execute(stmt, *args, **kwargs)
        tables = _tables(stmt)
        what = ", ".join(qualified(t) for t in sorted(tables))

        def run(s):
            frozen = s.execute(stmt, *args, **kwargs).freeze()
            return frozen(), len(frozen.data)

        return await self._on_databricks(run, what, tables)

    async def scalar(self, stmt, *args, **kwargs):
        return (await self.execute(stmt, *args, **kwargs)).scalar()

    async def scalars(self, stmt, *args, **kwargs):
        return (await self.execute(stmt, *args, **kwargs)).scalars()

    async def get(self, entity, ident, **kwargs):
        table = entity.__tablename__
        if table not in DATABRICKS_TABLES:
            self._pg_tables.add(table)
            return await self._pg.get(entity, ident, **kwargs)

        def run(s):
            obj = s.get(entity, ident, **kwargs)
            return obj, int(obj is not None)

        return await self._on_databricks(run, qualified(table), {table})

    async def close(self) -> None:
        self._report()
        if self._dbx is not None:
            dbx, self._dbx = self._dbx, None
            await asyncio.to_thread(dbx.close)
        await self._pg.close()

    def __getattr__(self, name: str) -> Any:  # add, flush, commit, rollback, info...: Postgres
        return getattr(self._pg, name)
