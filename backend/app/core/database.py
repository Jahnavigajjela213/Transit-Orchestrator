"""SQLAlchemy async engine + session helpers (PostgreSQL by default, SQLite as a no-server fallback)."""
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import Request
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings


class Base(DeclarativeBase):
    pass


def _ensure_sqlite_dir(url: str) -> None:
    if url.startswith("sqlite"):
        path = url.split("///", 1)[-1]
        if path and path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)


def build_engine(url: str):
    _ensure_sqlite_dir(url)
    is_sqlite = url.startswith("sqlite")
    kwargs = {"connect_args": {"timeout": 30}} if is_sqlite else {"pool_size": 10, "max_overflow": 20, "pool_pre_ping": True}
    eng = create_async_engine(url, echo=False, **kwargs)
    if is_sqlite:
        @event.listens_for(eng.sync_engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _):  # noqa: ANN001
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA busy_timeout=30000")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()
    return eng


engine = build_engine(settings.database_url)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


def rebind(url: str) -> None:
    """Point the app at another database (used by tests)."""
    global engine
    engine = build_engine(url)
    SessionLocal.configure(bind=engine)


async def ensure_database(url: str | None = None) -> None:
    """Create the PostgreSQL database if it is missing (needs a role allowed to CREATE DATABASE)."""
    url = url or settings.database_url
    if not url.startswith("postgresql") or not settings.db_auto_create:
        return
    import asyncpg
    from sqlalchemy.engine import make_url

    u = make_url(url)
    dbname = u.database
    try:
        conn = await asyncpg.connect(user=u.username, password=u.password, host=u.host or "localhost", port=u.port or 5432, database="postgres")
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(
            f"Cannot connect to PostgreSQL at {u.host}:{u.port or 5432} as {u.username}. "
            "Is PostgreSQL running, and are the user/password in DATABASE_URL correct?"
        ) from e
    try:
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", dbname)
        if not exists:
            await conn.execute(f'CREATE DATABASE "{dbname}"')
    finally:
        await conn.close()


# Read-only POST endpoints that may read through Databricks like a GET (they only add audit records).
READ_ONLY_POSTS = {"/api/assistant/ask", "/api/performance/ask"}


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        if settings.read_source == "databricks" and (request.method == "GET" or request.url.path in READ_ONLY_POSTS):
            from app.core.hybrid_session import HybridSession

            hybrid = HybridSession(session, f"{request.method} {request.url.path}")
            try:
                yield hybrid  # type: ignore[misc]
            finally:
                await hybrid.close()
            return
        yield session


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Session for background work: commits on success, rolls back on error."""
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# Columns added after the first release. create_all() makes new tables but never alters existing ones, so
# these are added in place on start. (A production deployment would use Alembic migrations instead.)
ADDED_COLUMNS = [("events", "note", "TEXT")]


async def create_all() -> None:
    from app import models  # noqa: F401  (register tables)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns)
    from app.sync.databricks import install_triggers  # Databricks change capture (needs the tables)

    await install_triggers()


def _add_missing_columns(sync_conn) -> None:
    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    for table, column, ddl_type in ADDED_COLUMNS:
        if column not in {c["name"] for c in insp.get_columns(table)}:
            sync_conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))


async def drop_all() -> None:
    from app import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
