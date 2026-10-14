"""Shadow mode: what the agent would have done next to what people actually did."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep, require_roles
from app.core.clock import now
from app.models import ShadowRecommendation, User, Workflow
from app.orchestrator import shadow

router = APIRouter(prefix="/api/shadow", tags=["shadow mode"])


@router.get("")
async def list_shadow(user: CurrentUser, s: SessionDep, status: Optional[str] = None, limit: int = 200):
    await shadow.expire_unmatched(user.tenant_id)
    q = select(ShadowRecommendation).where(ShadowRecommendation.tenant_id == user.tenant_id)
    if status:
        q = q.where(ShadowRecommendation.status.in_(status.split(",")))
    rows = (await s.execute(q.order_by(ShadowRecommendation.recommended_at.desc()).limit(limit))).scalars().all()
    wfs = {w.id: w for w in (await s.execute(select(Workflow).where(Workflow.id.in_({r.workflow_id for r in rows})))).scalars()} if rows else {}
    return [shadow.to_dict(r, wfs.get(r.workflow_id)) for r in rows]


@router.get("/summary")
async def summary(user: CurrentUser, s: SessionDep):
    await shadow.expire_unmatched(user.tenant_id)
    return await shadow.summary(s, user.tenant_id)


class ReviewIn(BaseModel):
    verdict: str  # agent_better | human_better | same
    note: Optional[str] = None


@router.post("/{rec_id}/review")
async def review(rec_id: str, body: ReviewIn, s: SessionDep, user: User = Depends(require_roles("dispatcher", "shop_manager"))):
    if body.verdict not in ("agent_better", "human_better", "same"):
        raise HTTPException(400, "Verdict must be agent_better, human_better or same.")
    r = await s.get(ShadowRecommendation, rec_id)
    if not r or r.tenant_id != user.tenant_id:
        raise HTTPException(404, "Not found.")
    r.verdict, r.review_note, r.reviewed_by, r.reviewed_at = body.verdict, body.note, user.full_name, now()
    await s.commit()
    return shadow.to_dict(r)


# ---------------------------------------------------------------- doing a step by hand, from the Shadow mode screen
# In shadow mode the agent changes nothing; a person handles the incident in the products. These endpoints let a
# tester play that person for one recommendation: the action goes through the product's own manual path, so it is
# recorded and matched exactly like work done in the product screens (see app/orchestrator/shadow.py).
from datetime import datetime  # noqa: E402

from app.core.clock import new_id  # noqa: E402
from app.core.errors import ProductAPIError  # noqa: E402
from app.identity.service import identity  # noqa: E402
from app.products.asset_mgmt import service as am  # noqa: E402
from app.products.common import product_session  # noqa: E402
from app.products.rider_comms import service as rc  # noqa: E402
from app.products.trip_mgmt import service as tm  # noqa: E402

ACTORS = ("dispatcher", "shop_manager")
BY_HAND = ("open_work_order", "pull_vehicle", "reassign_runs", "notify_riders", "return_to_service")


async def _own(s, user: User, rec_id: str) -> ShadowRecommendation:
    r = await s.get(ShadowRecommendation, rec_id)
    if not r or r.tenant_id != user.tenant_id:
        raise HTTPException(404, "Not found.")
    return r


@router.get("/{rec_id}/options")
async def options(rec_id: str, user: CurrentUser, s: SessionDep):
    """What the by-hand form offers: for run cover, the vehicles and drivers a person could pick."""
    r = await _own(s, user, rec_id)
    out: dict = {"step": r.step, "supported": r.step in BY_HAND}
    if r.step == "reassign_runs":
        async with product_session() as ps:
            vmap = await identity.map_for_system(ps, user.tenant_id, "trip_mgmt", "vehicle")  # code -> canonical
            dmap = await identity.map_for_system(ps, user.tenant_id, "trip_mgmt", "driver")
            vehicles = [{"id": vmap.get(v.vehicle_code), "label": v.label, "type": v.vehicle_type,
                         "wheelchair": (v.wheelchair_positions or 0) > 0, "status": v.status}
                        for v in await tm.list_vehicles(ps, user.tenant_id)]
            drivers = [{"id": dmap.get(d.driver_code), "label": d.name} for d in await tm.list_drivers(ps, user.tenant_id)]
        out["vehicles"] = sorted([v for v in vehicles if v["id"] and v["id"] != r.vehicle_id], key=lambda v: v["label"])
        out["drivers"] = sorted([d for d in drivers if d["id"]], key=lambda d: d["label"])
    return out


class ByHandIn(BaseModel):
    priority: Optional[str] = None  # open_work_order
    shop_start: Optional[datetime] = None
    shop_end: Optional[datetime] = None
    start: Optional[datetime] = None  # pull_vehicle
    end: Optional[datetime] = None
    assignments: list[dict] = []  # reassign_runs: [{run_id, vehicle_id, driver_id}] (canonical ids)
    message: Optional[str] = None  # notify_riders


@router.post("/{rec_id}/by-hand")
async def by_hand(rec_id: str, body: ByHandIn, s: SessionDep, user: User = Depends(require_roles(*ACTORS))):
    """Do this recommendation's step by hand in the product, as the person on shift would."""
    r = await _own(s, user, rec_id)
    if r.step not in BY_HAND:
        raise HTTPException(400, "This step cannot be done by hand from here.")
    rec, tid, vid = r.recommendation or {}, user.tenant_id, r.vehicle_id
    done: list[str] = []
    try:
        async with product_session() as ps:
            if r.step == "open_work_order":
                asset = await identity.to_external(ps, tid, vid, "asset_mgmt")
                wo = await am.create_work_order(
                    ps, tid, asset_number=asset, priority=body.priority or rec.get("priority") or "medium",
                    title=rec.get("title") or f"Fault reported on {r.vehicle_label}", fault_code=rec.get("fault_code"),
                    description="Opened by hand during shadow mode", shop_start=body.shop_start, shop_end=body.shop_end,
                    source="manual", created_by=user.full_name)
                done.append(f"Work order {wo.id} ({wo.priority}) opened")
            elif r.step == "pull_vehicle":
                code = await identity.to_external(ps, tid, vid, "trip_mgmt")
                start, end = body.start or now(), body.end or datetime.fromisoformat(rec["until"])
                await tm.block_vehicle(ps, tid, code, start, end, "Pulled by dispatcher", f"manual:{new_id('blk')}", by=user.full_name)
                done.append(f"{r.vehicle_label} pulled from the schedule")
            elif r.step == "reassign_runs":
                for a in body.assignments:
                    vcode = await identity.to_external(ps, tid, a["vehicle_id"], "trip_mgmt")
                    dcode = await identity.to_external(ps, tid, a["driver_id"], "trip_mgmt")
                    await tm.assign_run(ps, tid, a["run_id"], vcode, dcode, f"manual:{new_id('asg')}", by=user.full_name)
                    done.append(f"{a['run_id']} reassigned")
            elif r.step == "notify_riders":
                trips = await tm.trips_for_runs(ps, tid, rec.get("runs") or [])
                text = body.message or f"Your ride may be delayed: vehicle {r.vehicle_label} is out of service and a replacement is on its way."
                for t in trips:
                    await rc.send(ps, tid, rider_id=t.rider_id, trip_id=t.id, kind="service_change", message=text, workflow_id=None,
                                  idempotency_key=new_id("manual"), by=user.full_name)
                done.append(f"{len(trips)} rider(s) messaged")
            elif r.step == "return_to_service":
                code = await identity.to_external(ps, tid, vid, "trip_mgmt")
                blocks = [b for b in await tm.active_blocks(ps, tid) if b.vehicle_code == code]  # every block, incl. future ones
                for b in blocks:
                    await tm.unblock_vehicle(ps, tid, b.source_ref, "Returned to service by dispatcher", by=user.full_name)
                if not blocks:
                    await tm.mark_available_by_hand(ps, tid, code, by=user.full_name)
                done.append(f"{r.vehicle_label} returned to the schedule")
    except ProductAPIError as e:
        raise HTTPException(400, e.message)
    except (KeyError, ValueError, TypeError) as e:
        raise HTTPException(400, f"Missing detail for this step: {e}")
    return {"done": done}


@router.post("/{rec_id}/no-action")
async def no_action(rec_id: str, s: SessionDep, user: User = Depends(require_roles(*ACTORS))):
    """The person on shift decided this step was not needed: close it now instead of waiting a day."""
    r = await _own(s, user, rec_id)
    if r.status != "open":
        raise HTTPException(400, "Only a recommendation still waiting for people can be closed as no action.")
    r.status, r.review_note, r.reviewed_by, r.reviewed_at = "no_action", "Person decided no action was needed", user.full_name, now()
    await s.commit()
    return shadow.to_dict(r)
