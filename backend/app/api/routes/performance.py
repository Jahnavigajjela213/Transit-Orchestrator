"""Operator Performance SLM endpoints."""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select

from app.analytics import insights as I
from app.analytics import model as M
from app.analytics import slm
from app.api.deps import CurrentUser, SessionDep, require_roles
from app.audit import service as audit
from app.core.clock import now
from app.core.config import settings
from app.models import NoShowLog, PerformanceModel, User

router = APIRouter(prefix="/api/performance", tags=["operator performance SLM"])


async def _need_model(s, tenant_id: str) -> PerformanceModel:
    pm = await M.active_model(s, tenant_id)
    if not pm:
        raise HTTPException(409, "No model trained yet. Train the model first.")
    return pm


@router.get("/summary")
async def summary(user: CurrentUser, s: SessionDep):
    rows = await M.load_history(s, user.tenant_id)
    if not rows:
        raise HTTPException(409, "No operations history yet.")
    pm = await M.active_model(s, user.tenant_id)
    out = I.summary(rows)
    since = now().date().toordinal() - 30
    from datetime import date

    frequent = (await s.execute(select(NoShowLog.rider_id, func.count()).where(
        NoShowLog.tenant_id == user.tenant_id, NoShowLog.kind == "no_show", NoShowLog.service_date >= date.fromordinal(since))
        .group_by(NoShowLog.rider_id).having(func.count() >= 3))).all()
    out["riders_with_3plus_no_shows_30d"] = len(frequent)
    out["model"] = M.model_card(pm) if pm else None
    out["slm_provider"] = settings.slm_provider
    out["suggested_questions"] = await slm.suggestions(s, user.tenant_id)
    return out


@router.get("/plan")
async def plan(user: CurrentUser, s: SessionDep, target: Optional[float] = None):
    pm = await _need_model(s, user.tenant_id)
    rows = await M.load_history(s, user.tenant_id)
    return {**I.plan(M.model_from_row(pm), rows, target), "model_version": pm.version}


@router.post("/train")
async def train(s: SessionDep, user: User = Depends(require_roles("admin", "dispatcher"))):
    try:
        pm = await M.train(s, user.tenant_id, user.full_name)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await audit.record(s, tenant_id=user.tenant_id, record_type="model_trained", actor=user.full_name, actor_type="human",
                       model_used=f"{pm.kind} v{pm.version}", data_considered={"rows": pm.rows, "from": str(pm.date_from), "to": str(pm.date_to)},
                       recommendation=pm.metrics, outcome=f"version {pm.version}",
                       explanation=f"Trained performance model v{pm.version} on {pm.rows:,} runs; holdout daily OTP error {pm.metrics.get('holdout_daily_otp_mae_pp')} pts.")
    await s.commit()
    return M.model_card(pm)


@router.get("/models")
async def models(user: CurrentUser, s: SessionDep):
    rows = (await s.execute(select(PerformanceModel).where(PerformanceModel.tenant_id == user.tenant_id)
                            .order_by(PerformanceModel.version.desc()))).scalars()
    return [{**M.model_card(m), "active": m.active} for m in rows]


class AskIn(BaseModel):
    question: str


@router.post("/ask")
async def ask(body: AskIn, user: CurrentUser, s: SessionDep):
    if not body.question.strip():
        raise HTTPException(400, "Type a question first.")
    await _need_model(s, user.tenant_id)
    res = await slm.answer(s, user.tenant_id, body.question)
    await audit.record(s, tenant_id=user.tenant_id, record_type="assistant_answer", actor=user.full_name, actor_type="human",
                       data_considered={"question": body.question, "intent": res["intent"]}, model_used=res["model"], outcome="answered",
                       explanation=res["answer"][:2000])
    await s.commit()
    return res


@router.get("/training-data")
async def training_data(user: CurrentUser, s: SessionDep):
    """Chat-format fine-tuning set grounded in this agency's history, for tuning a small model in Databricks."""
    await _need_model(s, user.tenant_id)
    data = await slm.training_dataset(s, user.tenant_id)
    body = "\n".join(json.dumps(x, default=str, ensure_ascii=False) for x in data)
    return StreamingResponse(iter([body]), media_type="application/x-ndjson",
                             headers={"Content-Disposition": f"attachment; filename=slm_finetune_{user.tenant_id}.jsonl"})
