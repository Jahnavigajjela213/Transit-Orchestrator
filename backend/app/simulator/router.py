from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import CurrentUser, require_roles
from app.core.event_bus import bus
from app.models import User
from app.simulator import service

router = APIRouter(prefix="/api/simulator", tags=["simulator"])


class FaultIn(BaseModel):
    vehicle_label: str
    fault_code: str


class PmIn(BaseModel):
    vehicle_label: str
    miles_over: Optional[int] = None


class VehicleIn(BaseModel):
    vehicle_label: str


class InjectionIn(BaseModel):
    target: str
    mode: str  # off | fail_once | fail_always


class StreamIn(BaseModel):
    enabled: bool
    fault_probability: Optional[float] = None
    no_show_probability: Optional[float] = None


class NoShowIn(BaseModel):
    run_id: Optional[str] = None
    kind: str = "no_show"  # no_show | late_cancel
    prefer: str = "any"  # any | standby | late


async def _run(coro):
    try:
        result = await coro
    except ValueError as e:
        raise HTTPException(400, str(e))
    await bus.drain()
    return result


@router.post("/fault")
async def fault(body: FaultIn, user: User = Depends(require_roles("dispatcher", "shop_manager"))):
    return await _run(service.inject_fault(user.tenant_id, body.vehicle_label, body.fault_code))


@router.post("/pm-overdue")
async def pm(body: PmIn, user: User = Depends(require_roles("dispatcher", "shop_manager"))):
    return await _run(service.flag_pm(user.tenant_id, body.vehicle_label, body.miles_over))


@router.post("/duplicate")
async def duplicate(body: VehicleIn, user: User = Depends(require_roles("dispatcher", "shop_manager"))):
    return await _run(service.duplicate_last_fault(user.tenant_id, body.vehicle_label))


@router.post("/no-show")
async def no_show(body: NoShowIn, user: User = Depends(require_roles("dispatcher", "shop_manager"))):
    return await _run(service.no_show(user.tenant_id, body.run_id, body.kind, body.prefer))


@router.get("/failures")
async def failures(user: CurrentUser):
    return await service.list_fault_injections(user.tenant_id)


@router.post("/failures")
async def set_failure(body: InjectionIn, user: User = Depends(require_roles("admin", "dispatcher"))):
    if body.mode not in ("off", "fail_once", "fail_always"):
        raise HTTPException(400, "Mode must be off, fail_once or fail_always.")
    try:
        return await service.set_fault_injection(user.tenant_id, body.target, body.mode)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/stream")
async def stream_status(user: CurrentUser):
    return {"enabled": service.background.telemetry_enabled, "fault_probability": service.background.fault_probability,
            "no_show_probability": service.background.no_show_probability}


@router.post("/stream")
async def stream(body: StreamIn, user: User = Depends(require_roles("admin", "dispatcher"))):
    service.background.telemetry_enabled = body.enabled
    if body.fault_probability is not None:
        service.background.fault_probability = max(0.0, min(1.0, body.fault_probability))
    if body.no_show_probability is not None:
        service.background.no_show_probability = max(0.0, min(1.0, body.no_show_probability))
    return {"enabled": service.background.telemetry_enabled, "fault_probability": service.background.fault_probability,
            "no_show_probability": service.background.no_show_probability}


@router.post("/pm-scan")
async def pm_scan(user: User = Depends(require_roles("admin", "dispatcher", "shop_manager"))):
    n = await service.scan_pm_all()
    await bus.drain()
    return {"flagged": n}


# ---- scenario testing with replayed events
class ScenarioIn(BaseModel):
    scenario_id: str


class ReplayIn(BaseModel):
    events: list[dict]
    shift_to_now: bool = True
    keep_dedupe: bool = False


@router.get("/scenarios")
async def scenarios(user: CurrentUser):
    from app.simulator.replay import SCENARIOS

    return SCENARIOS


@router.post("/scenarios/run")
async def run_scenario(body: ScenarioIn, user: User = Depends(require_roles("dispatcher", "admin"))):
    from app.simulator.replay import run_scenario as run

    return await _run(run(user.tenant_id, body.scenario_id))


@router.post("/replay")
async def replay(body: ReplayIn, user: User = Depends(require_roles("dispatcher", "admin"))):
    """Replay CloudEvents (e.g. a file from GET /api/events/export or an EventBridge archive)."""
    from pydantic import ValidationError

    from app.simulator.replay import replay_events

    try:
        return await _run(replay_events(user.tenant_id, body.events, shift_to_now=body.shift_to_now, keep_dedupe=body.keep_dedupe))
    except ValidationError as e:
        raise HTTPException(400, f"Not valid CloudEvents: {e.errors()[0].get('msg')}")


class ComplianceIn(BaseModel):
    driver_name: Optional[str] = None
    issue: str = "medical_card"  # medical_card | drug_test | training | suspended | clear


@router.post("/driver-compliance")
async def driver_compliance(body: ComplianceIn, user: User = Depends(require_roles("dispatcher", "admin", "shop_manager"))):
    """Make a driver non-compliant in Vestige (or clear it), to see the agent stop proposing them."""
    return await _run(service.set_driver_compliance(user.tenant_id, body.driver_name, body.issue))
