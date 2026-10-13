from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import CurrentUser, SessionDep, require_roles
from app.models import User
from app.policy.defaults import ALL_PERMISSIONS, DEFAULT_RULES, LEVELS, MODES, PERMISSIONS_BY_TYPE, PERSONA_PERMISSIONS, STEPS_BY_TYPE, WORKFLOW_NAMES
from app.policy.engine import policy_engine

router = APIRouter(prefix="/api/policies", tags=["policy and autonomy"])


@router.get("/{workflow_type}")
async def get_policy(workflow_type: str, user: CurrentUser, s: SessionDep):
    if workflow_type not in DEFAULT_RULES:
        raise HTTPException(404, "Unknown workflow type.")
    p = await policy_engine.get_policy(s, user.tenant_id, workflow_type)
    rules = await policy_engine.rules(s, user.tenant_id, workflow_type)
    await s.commit()
    return {"workflow_type": workflow_type, "version": p.version, "updated_by": p.updated_by, "updated_at": p.updated_at,
            "rules": {k: v for k, v in rules.items() if not k.startswith("_")},
            "meta": {"levels": LEVELS, "steps": [{"key": k, "label": l, "description": d} for k, l, d in STEPS_BY_TYPE[workflow_type]],
                     "name": WORKFLOW_NAMES[workflow_type], "workflow_types": [{"key": k, "name": v} for k, v in WORKFLOW_NAMES.items()],
                     "roles": ["dispatcher", "shop_manager", "admin"], "all_permissions": PERMISSIONS_BY_TYPE[workflow_type],
                     "severities": ["critical", "high", "medium", "low"], "modes": list(MODES), "personas": list(PERSONA_PERMISSIONS),
                     "persona_permission_options": ALL_PERMISSIONS}}


class PolicyIn(BaseModel):
    rules: dict


@router.put("/{workflow_type}")
async def put_policy(workflow_type: str, body: PolicyIn, s: SessionDep, user: User = Depends(require_roles("admin"))):
    if workflow_type not in DEFAULT_RULES:
        raise HTTPException(404, "Unknown workflow type.")
    try:
        p = await policy_engine.update(s, user.tenant_id, workflow_type, body.rules, user.full_name)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await s.commit()
    return {"version": p.version}
