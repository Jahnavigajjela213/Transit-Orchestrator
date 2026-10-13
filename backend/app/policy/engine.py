"""Policy and autonomy engine: decides, per tenant and per step, how much the agent may do."""
import copy
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.core.clock import new_id, now
from app.models import Policy
from app.policy.defaults import ALL_PERMISSIONS, DEFAULT_RULES, LEVELS, MODES


def _merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


class PolicyEngine:
    async def get_policy(self, s: AsyncSession, tenant_id: str, workflow_type: str) -> Policy:
        p = (await s.execute(select(Policy).where(Policy.tenant_id == tenant_id, Policy.workflow_type == workflow_type))).scalar_one_or_none()
        if not p:
            p = Policy(id=new_id("pol"), tenant_id=tenant_id, workflow_type=workflow_type, version=1,
                       rules=copy.deepcopy(DEFAULT_RULES[workflow_type]), updated_by="system", updated_at=now())
            s.add(p)
            await s.flush()
        return p

    async def rules(self, s: AsyncSession, tenant_id: str, workflow_type: str) -> dict[str, Any]:
        p = await self.get_policy(s, tenant_id, workflow_type)
        merged = _merge(DEFAULT_RULES[workflow_type], p.rules)
        merged["_version"] = p.version
        return merged

    @staticmethod
    def level_for(rules: dict, step: str, severity: Optional[str] = None) -> str:
        cfg = rules["steps"].get(step, {"level": "semi_autonomous"})
        if rules.get("mode") == "shadow" and step not in ("detect", "assess", "close"):
            return "shadow"  # workflow-level shadow mode overrides every write step
        if severity and severity in cfg.get("by_severity", {}):
            return cfg["by_severity"][severity]
        return cfg.get("level", "semi_autonomous")

    @staticmethod
    def acts_as(rules: dict, step: str) -> str:
        """Persona the agent serves when it acts on this step without a person deciding."""
        cfg = rules["steps"].get(step, {})
        return cfg.get("acts_as") or (cfg.get("approver_roles") or ["dispatcher"])[0]

    @staticmethod
    def persona_permissions(rules: dict, role: Optional[str]) -> set[str]:
        perms = set((rules.get("persona_permissions") or {}).get(role or "", []))
        return {"*"} if "*" in perms else perms

    @classmethod
    def effective_permissions(cls, rules: dict, role: Optional[str]) -> set[str]:
        """What the agent may do for this persona: its own grant intersected with the persona's."""
        agent = set(rules.get("agent_permissions", []))
        persona = cls.persona_permissions(rules, role)
        if "*" in persona:
            return agent
        if "*" in agent:
            return persona
        return agent & persona

    @staticmethod
    def approver_roles(rules: dict, step: str) -> list[str]:
        return rules["steps"].get(step, {}).get("approver_roles", ["dispatcher"])

    @staticmethod
    def validate(rules: dict) -> list[str]:
        errors = []
        for step, cfg in rules.get("steps", {}).items():
            if cfg.get("level") not in LEVELS:
                errors.append(f"{step}: level must be one of {', '.join(LEVELS)}")
            for sev, lvl in cfg.get("by_severity", {}).items():
                if lvl not in LEVELS:
                    errors.append(f"{step}.{sev}: level must be one of {', '.join(LEVELS)}")
            if cfg.get("acts_as") and cfg["acts_as"] not in (rules.get("persona_permissions") or {}):
                errors.append(f"{step}: acts_as must be one of the personas ({', '.join(rules.get('persona_permissions') or {})})")
        for k, v in rules.get("thresholds", {}).items():
            if not isinstance(v, (int, float)) or v < 0:
                errors.append(f"threshold {k} must be a non-negative number")
        if rules.get("mode", "live") not in MODES:
            errors.append(f"mode must be one of {', '.join(MODES)}")
        for role, perms in (rules.get("persona_permissions") or {}).items():
            bad = [p for p in perms if p != "*" and p not in ALL_PERMISSIONS]
            if bad:
                errors.append(f"persona {role}: unknown permission(s) {', '.join(bad)}")
        return errors

    async def update(self, s: AsyncSession, tenant_id: str, workflow_type: str, rules: dict, user_name: str) -> Policy:
        rules = {k: v for k, v in rules.items() if not k.startswith("_")}
        errors = self.validate(_merge(DEFAULT_RULES[workflow_type], rules))
        if errors:
            raise ValueError("; ".join(errors))
        p = await self.get_policy(s, tenant_id, workflow_type)
        before = copy.deepcopy(p.rules)
        p.rules = rules
        p.version += 1
        p.updated_by = user_name
        p.updated_at = now()
        await audit.record(
            s, tenant_id=tenant_id, record_type="policy_change", actor=user_name, actor_type="human",
            data_considered={"before": before}, recommendation={"after": rules}, outcome=f"version {p.version}",
            explanation=f"{user_name} updated the {workflow_type} policy to version {p.version}.",
        )
        return p


    async def upgrade_stored_policies(self, s: AsyncSession) -> int:
        """One-time, audited upgrade of policies saved before Vestige existed: their stored agent grant is a full list
        that would otherwise hide the new safety permissions from the vehicle health workflow."""
        upgraded = 0
        rows = (await s.execute(select(Policy).where(Policy.workflow_type == "vehicle_health"))).scalars().all()
        for p in rows:
            rules = copy.deepcopy(p.rules or {})
            if "safety" in rules or "agent_permissions" not in rules:
                continue
            before = copy.deepcopy(p.rules)
            rules["agent_permissions"] = list(dict.fromkeys(rules["agent_permissions"] + ["safety.open_defect", "safety.close_defect"]))
            rules["safety"] = copy.deepcopy(DEFAULT_RULES["vehicle_health"]["safety"])
            p.rules, p.version, p.updated_by, p.updated_at = rules, p.version + 1, "system upgrade", now()
            await audit.record(s, tenant_id=p.tenant_id, record_type="policy_change", actor="system upgrade", actor_type="system",
                               data_considered={"before": before}, recommendation={"after": rules}, outcome=f"version {p.version}",
                               explanation="Safety & compliance (Vestige) added: the agent may record and clear vehicle defects; "
                                           "brake, accessibility and critical faults are logged in Vestige.")
            upgraded += 1
        return upgraded


policy_engine = PolicyEngine()
