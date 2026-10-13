"""FastAPI application: wires the event backbone, orchestrator, products and API together."""
import asyncio
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (approvals, assistant, audit, auth, evals, events, fleet, metrics, performance, policies, schedule, shadow,
                            stream, system, workflows)
from app.audit.shipper import shipper
from app.core import database
from app.core.config import settings
from app.core.event_bus import bus
from app.core.logging import get_logger, setup_logging
from app.core.tracing import setup_tracing
from app.orchestrator.service import orchestrator
from app.products.asset_mgmt.router import router as asset_router
from app.products.rider_comms.router import router as rider_router
from app.products.safety.router import router as safety_router
from app.products.telematics.router import router as telematics_router
from app.products.trip_mgmt.router import router as trip_router
from app.products.workforce.router import router as workforce_router
from app.simulator import service as simulator
from app.simulator.router import router as simulator_router

setup_logging()
log = get_logger("app")


async def seed_database(with_history: bool) -> dict | None:
    from app.seed.generator import is_seeded, seed

    async with database.session_scope() as s:
        if await is_seeded(s):
            return None
        stats = await seed(s, settings.seed_random_seed)
    await ensure_safety_data()
    log.info("Seeded synthetic data: %s", stats)
    await train_missing_models()
    if with_history:
        asyncio.create_task(simulator.run_history(), name="demo-history")
    return stats


async def ensure_safety_data() -> None:
    """Vestige records for every driver and vehicle; also back-fills databases created before Vestige was added."""
    from app.policy.engine import policy_engine
    from app.seed.safety import ensure_safety_seed

    async with database.session_scope() as s:
        created = await ensure_safety_seed(s)
        upgraded = await policy_engine.upgrade_stored_policies(s)
    if any(created.values()):
        log.info("Vestige (safety) data created: %s", created)
    if upgraded:
        log.info("Upgraded %d stored policy(ies) with the Vestige permissions", upgraded)


async def train_missing_models() -> None:
    """Train the Operator Performance model for any tenant that has history but no model yet."""
    from sqlalchemy import select

    from app.analytics import model as M
    from app.models import Tenant

    async with database.session_scope() as s:
        tenants = [t.id for t in (await s.execute(select(Tenant))).scalars()]
    for tid in tenants:
        async with database.session_scope() as s:
            if await M.active_model(s, tid) is None:
                try:
                    pm = await M.train(s, tid, "system (first start)")
                    log.info("Trained performance model v%s for %s (%s runs)", pm.version, tid, pm.rows)
                except ValueError as e:
                    log.warning("Model not trained for %s: %s", tid, e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await database.ensure_database()
    await database.create_all()
    await orchestrator.start()  # subscribes handlers before the bus replays pending events
    await bus.start()
    if settings.seed_on_startup:
        await seed_database(with_history=settings.seed_with_history)
    await ensure_safety_data()
    await train_missing_models()
    simulator.background.start()
    shipper.start()
    log.info("Ready. DB=%s LLM=%s SLM=%s adapters=%s bus=%s", settings.database_url.split("://")[0], settings.llm_provider,
             settings.slm_provider, settings.adapter_mode, settings.event_bus)
    yield
    await shipper.stop()
    await simulator.background.stop()
    await bus.stop()
    await orchestrator.stop()
    await database.engine.dispose()


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan,
              description="Event-driven agentic orchestration for TransitTechOS (local build with synthetic products).")
setup_tracing(app)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def request_log(request: Request, call_next):
    rid = request.headers.get("X-Request-ID", uuid.uuid4().hex[:12])
    t0 = time.perf_counter()
    response = await call_next(request)
    if not request.url.path.endswith("/stream"):
        log.debug("%s %s %s %.0fms rid=%s", request.method, request.url.path, response.status_code, (time.perf_counter() - t0) * 1000, rid)
    response.headers["X-Request-ID"] = rid
    return response


for r in (auth.router, approvals.router, workflows.router, fleet.router, schedule.router, audit.router, policies.router, events.router,
          metrics.router, performance.router, assistant.router, stream.router, system.router, shadow.router, evals.router, simulator_router,
          asset_router, trip_router, workforce_router, rider_router, telematics_router, safety_router):
    app.include_router(r)
