"""Test setup: a fresh PostgreSQL test database per run, no demo history, full app lifespan.

Uses TEST_DATABASE_URL, else TEST_DATABASE_URL in backend/.env, else the DATABASE_URL in backend/.env with the
database renamed to transit_orchestrator_test (dropped and recreated each run), so the tests use the same
PostgreSQL user and password as the app. To run without Postgres:
    TEST_DATABASE_URL=sqlite+aiosqlite:///./data/test.db pytest
"""
import asyncio
import os
import shutil
import tempfile

_TMP = tempfile.mkdtemp(prefix="transit-tests-")


def _test_db_url() -> str:
    if os.environ.get("TEST_DATABASE_URL"):
        return os.environ["TEST_DATABASE_URL"]
    env: dict[str, str] = {}
    env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if os.path.exists(env_file):
        for line in open(env_file, encoding="utf-8"):
            k, sep, v = line.strip().partition("=")
            if sep and not k.startswith("#"):
                env[k.strip()] = v.strip()
    if env.get("TEST_DATABASE_URL"):
        return env["TEST_DATABASE_URL"]
    app_url = env.get("DATABASE_URL", "")
    if app_url.startswith("postgresql"):
        return app_url.rsplit("/", 1)[0] + "/transit_orchestrator_test"
    return "postgresql+asyncpg://postgres:postgres@localhost:5432/transit_orchestrator_test"


TEST_DB = _test_db_url()


def _recreate_postgres(url: str) -> None:
    import asyncpg
    from sqlalchemy.engine import make_url

    u = make_url(url)

    async def go():
        conn = await asyncpg.connect(user=u.username, password=u.password, host=u.host, port=u.port or 5432, database="postgres")
        await conn.execute(f'DROP DATABASE IF EXISTS "{u.database}" WITH (FORCE)')
        await conn.execute(f'CREATE DATABASE "{u.database}"')
        await conn.close()

    asyncio.run(go())


if TEST_DB.startswith("postgresql"):
    _recreate_postgres(TEST_DB)
elif TEST_DB.startswith("sqlite"):
    _path = TEST_DB.split("///", 1)[-1]
    if os.path.exists(_path):
        os.remove(_path)

os.environ.update({
    "DATABASE_URL": TEST_DB,
    "CHECKPOINT_DB_PATH": f"{_TMP}/checkpoints.db",
    "SEED_WITH_HISTORY": "false",
    "AUDIT_MIRROR": "none",
    "LLM_PROVIDER": "mock",
    "ASSISTANT_PROVIDER": "mock",
    "SLM_PROVIDER": "mock",
    "ANTHROPIC_API_KEY": "",  # tests never call a paid model, even when .env has a key
    # the test database only: never read from or copy to the Databricks workspace configured in .env
    "READ_SOURCE": "postgres",
    "DATABRICKS_SYNC": "false",
    "EMBEDDINGS_ENABLED": "false",
    "ADAPTER_MODE": "mock",
    "PM_SCAN_INTERVAL_SECONDS": "100000",
    "TELEMETRY_STREAM_ENABLED": "false",
    "ENVIRONMENT": "local",
    "EVENT_REORDER_WINDOW_MS": "0",
    "AUTH_MODE": "local",
    "EVENT_BUS": "inmemory",
    "OTEL_ENABLED": "false",
})

import httpx  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402

from app.core.event_bus import bus  # noqa: E402
from app.main import app  # noqa: E402


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def client():
    async with app.router.lifespan_context(app):
        await bus.drain()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", timeout=60) as c:
            yield c
    shutil.rmtree(_TMP, ignore_errors=True)


async def login(client, email: str) -> dict:
    r = await client.post("/api/auth/login", json={"email": email, "password": "demo1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def dispatcher(client):
    return await login(client, "dispatcher@mvt.demo")


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def shop(client):
    return await login(client, "shopmanager@mvt.demo")


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def admin(client):
    return await login(client, "admin@mvt.demo")
