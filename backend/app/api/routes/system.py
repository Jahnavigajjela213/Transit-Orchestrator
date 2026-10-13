import aiosqlite
from fastapi import APIRouter, Depends

from app.api.deps import CurrentUser, require_roles
from app.core import database
from app.core.config import settings
from app.core.event_bus import bus
from app.agents import AGENTS
from app.llm.router import llm
from app.models import User

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/system/info")
async def info(user: CurrentUser):
    return {"app": settings.app_name, "environment": settings.environment, "event_bus": settings.event_bus,
            "llm_provider": llm.primary.name, "adapter_mode": settings.adapter_mode, "audit_mirror": settings.audit_mirror,
            "database": "postgresql" if settings.is_postgres else "sqlite", "slm_provider": llm.slm.name, "otel": settings.otel_enabled,
            "otel_exporter": ("otlp" if settings.otel_exporter_otlp_endpoint else "console") if settings.otel_enabled else None,
            "auth_mode": settings.auth_mode, "eventbridge_inbound": bool(settings.eventbridge_sqs_queue_url),
            "agents": [a.describe() for a in AGENTS.values()]}


@router.post("/admin/reset")
async def reset(user: User = Depends(require_roles("admin"))):
    """Wipe and re-seed all synthetic data (both tenants) and clear workflow checkpoints."""
    from app.main import seed_database

    await bus.drain()
    if settings.is_postgres:
        import psycopg

        async with await psycopg.AsyncConnection.connect(settings.psycopg_url, autocommit=True) as conn:
            for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
                try:
                    await conn.execute(f"DELETE FROM {table}")
                except Exception:
                    pass
    else:
        async with aiosqlite.connect(settings.checkpoint_db_path) as conn:
            for table in ("checkpoints", "writes"):
                try:
                    await conn.execute(f"DELETE FROM {table}")
                except Exception:
                    pass
            await conn.commit()
    await database.drop_all()
    await database.create_all()
    stats = await seed_database(with_history=False)
    return {"reset": True, "stats": stats}


@router.get("/agents")
async def agents(user: CurrentUser):
    """The domain agents and which steps each one handles."""
    from app.agents import supervisor

    return {"agents": [a.describe() for a in AGENTS.values()],
            "plans": {wt: supervisor.plan(wt) for wt in ("vehicle_health", "no_show_recovery")}}
