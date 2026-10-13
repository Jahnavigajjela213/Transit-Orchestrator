"""Model evaluation runs (use before switching LLM provider or model)."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep, require_roles
from app.core.config import settings
from app.llm import evals
from app.llm.router import llm
from app.models import EvalRun, User

router = APIRouter(prefix="/api/evals", tags=["model evaluation"])


@router.get("")
async def list_runs(user: CurrentUser, s: SessionDep, limit: int = 30):
    rows = (await s.execute(select(EvalRun).where(EvalRun.tenant_id == user.tenant_id).order_by(EvalRun.started_at.desc()).limit(limit))).scalars()
    return {"runs": [evals.to_dict(r, with_cases=False) for r in rows],
            "current": {"llm_provider": llm.primary.name, "slm_provider": llm.slm.name, "model_fast": llm.primary.model_for("fast"),
                        "model_smart": llm.primary.model_for("smart")},
            "providers": ["mock", "anthropic", "bedrock", "ollama"],
            "configured": {"anthropic": bool(settings.anthropic_api_key), "bedrock": bool(settings.bedrock_model_fast), "ollama": True, "mock": True},
            "cases": [{"id": c["id"], "task": c["task"], "title": c["title"], "checks": [n for n, _ in c["checks"]]} for c in evals.CASES]}


@router.get("/{run_id}")
async def get_run(run_id: str, user: CurrentUser, s: SessionDep):
    r = await s.get(EvalRun, run_id)
    if not r or r.tenant_id != user.tenant_id:
        raise HTTPException(404, "Evaluation run not found.")
    return evals.to_dict(r)


class RunIn(BaseModel):
    provider: str
    pass_threshold: Optional[float] = 90.0


@router.post("/run")
async def run(body: RunIn, user: User = Depends(require_roles("admin"))):
    if body.provider not in ("mock", "anthropic", "bedrock", "ollama"):
        raise HTTPException(400, "Provider must be mock, anthropic, bedrock or ollama.")
    r = await evals.run_suite(user.tenant_id, body.provider, run_by=user.full_name, pass_threshold=body.pass_threshold or 90.0)
    return evals.to_dict(r)
