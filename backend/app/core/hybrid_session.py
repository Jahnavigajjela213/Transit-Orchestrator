"""Request session for READ_SOURCE=databricks.

Queries that read only product/analytics tables (app/core/databricks.py) run on the Databricks SQL warehouse; queries on
orchestration tables (workflows, approvals, users, policies...) and every write run on Postgres. A query that mixes the
two cannot run in either place and is refused. A failed Databricks read becomes HTTP 502: there is no fallback.
"""
import asyncio
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Table
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from sqlalchemy.sql import Select
from sqlalchemy.sql.util import find_tables

from app.core.databricks import DATABRICKS_TABLES, qualified, read_engine


def _tables(stmt) -> set[str]:
    # real tables only: subqueries/aliases are walked into, so their underlying tables are counted too
    return {t.name for t in find_tables(stmt, include_joins=True, include_aliases=True) if isinstance(t, Table)}


class HybridSession:
    def __init__(self, pg: AsyncSession) -> None:
        self._pg = pg
        self._dbx: Session | None = None

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

    async def _on_databricks(self, fn, what: str):
        def run():
            if self._dbx is None:
                self._dbx = Session(read_engine())
            return fn(self._dbx)

        try:
            return await asyncio.to_thread(run)
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001  no fallback to Postgres: report it
            if self._dbx is not None:
                self._dbx.rollback()
            raise HTTPException(502, f"Could not read {what} from Databricks: {type(e).__name__}: {str(e).splitlines()[0][:400]}")

    # ---- the AsyncSession surface the routes use
    async def execute(self, stmt, *args, **kwargs):
        if self._target(stmt) == "postgres":
            return await self._pg.execute(stmt, *args, **kwargs)
        what = ", ".join(qualified(t) for t in sorted(_tables(stmt)))
        return await self._on_databricks(lambda s: s.execute(stmt, *args, **kwargs).freeze()(), what)

    async def scalar(self, stmt, *args, **kwargs):
        return (await self.execute(stmt, *args, **kwargs)).scalar()

    async def scalars(self, stmt, *args, **kwargs):
        return (await self.execute(stmt, *args, **kwargs)).scalars()

    async def get(self, entity, ident, **kwargs):
        table = entity.__tablename__
        if table not in DATABRICKS_TABLES:
            return await self._pg.get(entity, ident, **kwargs)
        return await self._on_databricks(lambda s: s.get(entity, ident, **kwargs), qualified(table))

    async def close(self) -> None:
        if self._dbx is not None:
            dbx, self._dbx = self._dbx, None
            await asyncio.to_thread(dbx.close)
        await self._pg.close()

    def __getattr__(self, name: str) -> Any:  # add, flush, commit, rollback, info...: Postgres
        return getattr(self._pg, name)
