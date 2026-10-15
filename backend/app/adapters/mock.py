"""Adapters backed by the synthetic in-process products (ADAPTER_MODE=mock)."""
from datetime import datetime
from typing import Any, Optional

from app.adapters.base import ActionContext, AssetAdapter, RiderCommsAdapter, SafetyAdapter, TripAdapter, WorkforceAdapter
from app.adapters.resilience import protected_write
from app.core.database import SessionLocal
from app.core.errors import ProductAPIError
from app.identity.service import identity
from app.products.asset_mgmt import service as am
from app.products.common import product_session
from app.products.rider_comms import service as rc
from app.products.safety import service as sf
from app.products.trip_mgmt import service as tm
from app.products.workforce import service as wf


def _iso(d: Optional[datetime]) -> Optional[str]:
    return d.isoformat() if d else None


async def _ext(s, ctx: ActionContext, canonical_id: str, system: str) -> str:
    ext = await identity.to_external(s, ctx.tenant_id, canonical_id, system)
    if not ext:
        raise ProductAPIError(system, "identity", f"{system.replace('_', ' ').capitalize()} has no record linked to this {canonical_id.split('_')[0].replace('veh', 'vehicle').replace('drv', 'driver').replace('trp', 'trip')}")
    return ext


class MockAssetAdapter(AssetAdapter):
    async def vehicle_health(self, ctx: ActionContext, vehicle_id: str) -> dict[str, Any]:
        async with SessionLocal() as s:
            asset_no = await _ext(s, ctx, vehicle_id, self.system)
            a = await am.get_asset(s, ctx.tenant_id, asset_no)
            open_wos = await am.open_work_orders_for_asset(s, ctx.tenant_id, asset_no)
            return {
                "asset_number": a.asset_number, "unit_label": a.unit_label, "make": a.make, "model": a.model, "year": a.year,
                "odometer": a.odometer, "pm_miles_over": am.pm_miles_over(a), "last_pm_date": a.last_pm_date.isoformat(),
                "depot": a.depot, "status": a.status,
                "open_work_orders": [{"id": w.id, "title": w.title, "status": w.status, "priority": w.priority} for w in open_wos],
            }

    async def fault_code(self, ctx: ActionContext, code: str) -> Optional[dict[str, Any]]:
        async with SessionLocal() as s:
            fc = await am.fault_code(s, code)
            return {c.name: getattr(fc, c.name) for c in fc.__table__.columns} if fc else None

    async def find_shop_window(self, ctx, vehicle_id, earliest, est_hours, immediate):
        async with SessionLocal() as s:
            asset_no = await _ext(s, ctx, vehicle_id, self.system)
            a = await am.get_asset(s, ctx.tenant_id, asset_no)
            start, end, depot = await am.find_shop_window(s, ctx.tenant_id, a.depot, earliest, est_hours, immediate)
            return {"start": start.isoformat(), "end": end.isoformat(), "depot": depot}

    async def create_work_order(self, ctx, *, vehicle_id, priority, title, description, fault_code, shop_start, shop_end, idempotency_key):
        async def call():
            async with product_session() as s:
                asset_no = await _ext(s, ctx, vehicle_id, self.system)
                wo = await am.create_work_order(
                    s, ctx.tenant_id, asset_number=asset_no, priority=priority, title=title, description=description,
                    fault_code=fault_code, shop_start=shop_start, shop_end=shop_end, source="orchestrator",
                    external_ref=ctx.workflow_id, created_by=ctx.actor,
                )
                return {"work_order_id": wo.id, "asset_number": asset_no, "shop_start": _iso(wo.shop_start), "shop_end": _iso(wo.shop_end), "depot": wo.shop_depot}
        return await protected_write(ctx, self.system, "create_work_order", idempotency_key, call)

    async def cancel_work_order(self, ctx, work_order_id, reason):
        async def call():
            async with product_session() as s:
                wo = await am.cancel_work_order(s, ctx.tenant_id, work_order_id, reason, by=ctx.actor)
                return {"work_order_id": wo.id, "status": wo.status}
        return await protected_write(ctx, self.system, "cancel_work_order", f"{ctx.workflow_id}:cancel_wo:{work_order_id}", call)

    async def get_work_order(self, ctx, work_order_id):
        async with SessionLocal() as s:
            wo = await am.get_work_order(s, ctx.tenant_id, work_order_id)
            return {c.name: getattr(wo, c.name) for c in wo.__table__.columns}


class MockTripAdapter(TripAdapter):
    async def _run_dict(self, s, ctx, r, vmap, dmap) -> dict[str, Any]:
        trips = await tm.trips_for_runs(s, ctx.tenant_id, [r.id])
        return {
            "run_id": r.id, "route_name": r.route_name, "block_name": r.block_name, "service_date": r.service_date.isoformat(),
            "start": r.start_time.isoformat(), "end": r.end_time.isoformat(), "status": r.status,
            "vehicle_id": vmap.get(r.vehicle_code), "driver_id": dmap.get(r.driver_code),
            "riders": len(trips), "needs_wheelchair": any(t.needs_wheelchair for t in trips), "reassigned": r.reassigned,
        }

    async def _maps(self, s, ctx):
        return (await identity.map_for_system(s, ctx.tenant_id, self.system, "vehicle"),
                await identity.map_for_system(s, ctx.tenant_id, self.system, "driver"))

    async def vehicle(self, ctx, vehicle_id):
        async with SessionLocal() as s:
            code = await _ext(s, ctx, vehicle_id, self.system)
            v = await tm.get_vehicle(s, ctx.tenant_id, code)
            return {"vehicle_id": vehicle_id, "vehicle_code": code, "label": v.label, "vehicle_type": v.vehicle_type,
                    "capacity": v.capacity, "wheelchair_positions": v.wheelchair_positions, "depot": v.depot, "status": v.status}

    async def fleet(self, ctx):
        async with SessionLocal() as s:
            vmap, _ = await self._maps(s, ctx)
            return [{"vehicle_id": vmap.get(v.vehicle_code), "vehicle_code": v.vehicle_code, "label": v.label, "vehicle_type": v.vehicle_type,
                     "capacity": v.capacity, "wheelchair_positions": v.wheelchair_positions, "depot": v.depot, "status": v.status}
                    for v in await tm.list_vehicles(s, ctx.tenant_id)]

    async def runs_for_vehicle(self, ctx, vehicle_id, start, end):
        async with SessionLocal() as s:
            code = await _ext(s, ctx, vehicle_id, self.system)
            vmap, dmap = await self._maps(s, ctx)
            return [await self._run_dict(s, ctx, r, vmap, dmap) for r in await tm.runs_for_vehicle_between(s, ctx.tenant_id, code, start, end)]

    async def runs_between(self, ctx, start, end):
        async with SessionLocal() as s:
            vmap, dmap = await self._maps(s, ctx)
            return [{"run_id": r.id, "start": r.start_time.isoformat(), "end": r.end_time.isoformat(), "service_date": r.service_date.isoformat(),
                     "vehicle_id": vmap.get(r.vehicle_code), "driver_id": dmap.get(r.driver_code), "status": r.status}
                    for r in await tm.runs_between(s, ctx.tenant_id, start, end)]

    async def blocks_between(self, ctx, start, end):
        async with SessionLocal() as s:
            vmap, _ = await self._maps(s, ctx)
            return [{"vehicle_id": vmap.get(b.vehicle_code), "start": b.start.isoformat(), "end": b.end.isoformat(), "reason": b.reason}
                    for b in await tm.active_blocks(s, ctx.tenant_id, start, end)]

    async def block_vehicle(self, ctx, *, vehicle_id, start, end, reason, ref, idempotency_key):
        async def call():
            async with product_session() as s:
                code = await _ext(s, ctx, vehicle_id, self.system)
                b = await tm.block_vehicle(s, ctx.tenant_id, code, start, end, reason, ref)
                return {"block_id": b.id, "vehicle_code": code, "from": b.start.isoformat(), "until": b.end.isoformat()}
        return await protected_write(ctx, self.system, "block_vehicle", idempotency_key, call)

    async def unblock_vehicle(self, ctx, *, ref, reason, idempotency_key):
        async def call():
            async with product_session() as s:
                b = await tm.unblock_vehicle(s, ctx.tenant_id, ref, reason)
                return {"block_id": b.id if b else None, "restored": bool(b)}
        return await protected_write(ctx, self.system, "unblock_vehicle", idempotency_key, call)

    async def assign_run(self, ctx, *, run_id, vehicle_id, driver_id, ref, idempotency_key):
        async def call():
            async with product_session() as s:
                vcode = await _ext(s, ctx, vehicle_id, self.system)
                dcode = await _ext(s, ctx, driver_id, self.system)
                r = await tm.assign_run(s, ctx.tenant_id, run_id, vcode, dcode, ref)
                return {"run_id": r.id, "vehicle_code": r.vehicle_code, "driver_code": r.driver_code,
                        "original_vehicle_code": r.original_vehicle_code, "original_driver_code": r.original_driver_code}
        return await protected_write(ctx, self.system, "assign_run", idempotency_key, call)

    async def revert_run(self, ctx, *, run_id, idempotency_key):
        async def call():
            async with product_session() as s:
                r = await tm.revert_run(s, ctx.tenant_id, run_id)
                return {"run_id": r.id, "vehicle_code": r.vehicle_code, "driver_code": r.driver_code}
        return await protected_write(ctx, self.system, "revert_run", idempotency_key, call)

    async def trips_for_runs(self, ctx, run_ids):
        async with SessionLocal() as s:
            return [{"trip_id": t.id, "run_id": t.run_id, "rider_id": t.rider_id, "pickup_time": t.pickup_time.isoformat(),
                     "eta": t.eta.isoformat(), "pickup_stop": t.pickup_stop, "needs_wheelchair": t.needs_wheelchair}
                    for t in await tm.trips_for_runs(s, ctx.tenant_id, run_ids)]

    async def update_trip_eta(self, ctx, *, trip_id, eta, idempotency_key):
        async def call():
            async with product_session() as s:
                t = await tm.update_trip_eta(s, ctx.tenant_id, trip_id, eta)
                return {"trip_id": t.id, "eta": t.eta.isoformat()}
        return await protected_write(ctx, self.system, "update_trip_eta", idempotency_key, call)


    # --- No-Show Recovery ---
    @staticmethod
    def _trip(t) -> dict[str, Any]:
        return {"trip_id": t.id, "run_id": t.run_id, "rider_id": t.rider_id, "pickup_time": t.pickup_time.isoformat(), "eta": t.eta.isoformat(),
                "pickup_stop": t.pickup_stop, "dropoff_stop": t.dropoff_stop, "needs_wheelchair": t.needs_wheelchair, "status": t.status}

    async def get_trip(self, ctx, trip_id):
        async with SessionLocal() as s:
            return self._trip(await tm.get_trip(s, ctx.tenant_id, trip_id))

    async def run_detail(self, ctx, run_id):
        async with SessionLocal() as s:
            r = await tm.get_run(s, ctx.tenant_id, run_id)
            vmap, dmap = await self._maps(s, ctx)
            v = await tm.get_vehicle(s, ctx.tenant_id, r.vehicle_code) if r.vehicle_code else None
            from app.models import TripDriver
            d = await s.get(TripDriver, r.driver_code) if r.driver_code else None
            trips = await tm.run_trips(s, ctx.tenant_id, run_id)
            return {"run_id": r.id, "route_name": r.route_name, "block_name": r.block_name, "service_date": r.service_date.isoformat(),
                    "start": r.start_time.isoformat(), "end": r.end_time.isoformat(), "status": r.status, "delay_minutes": r.delay_minutes,
                    "vehicle_id": vmap.get(r.vehicle_code), "vehicle_label": v.label if v else None, "vehicle_type": v.vehicle_type if v else None,
                    "capacity": v.capacity if v else 0, "wheelchair_positions": v.wheelchair_positions if v else 0,
                    "driver_id": dmap.get(r.driver_code), "driver_name": d.name if d else None,
                    "trips": [self._trip(t) for t in trips]}

    async def waitlist_candidates(self, ctx, run_id, start, end):
        async with SessionLocal() as s:
            r = await tm.get_run(s, ctx.tenant_id, run_id)
            from app.models import Rider
            out = []
            for q in await tm.waitlist_candidates(s, ctx.tenant_id, r, start, end):
                rider = await s.get(Rider, q.rider_id)
                out.append({"request_id": q.id, "rider_id": q.rider_id, "rider_name": rider.name if rider else q.rider_id,
                            "window_start": q.window_start.isoformat(), "window_end": q.window_end.isoformat(), "pickup_stop": q.pickup_stop,
                            "dropoff_stop": q.dropoff_stop, "purpose": q.purpose, "needs_wheelchair": q.needs_wheelchair,
                            "requested_at": q.created_at.isoformat()})
            return out

    async def book_request(self, ctx, *, request_id, run_id, pickup_time, ref, idempotency_key):
        async def call():
            async with product_session() as s:
                t = await tm.book_request(s, ctx.tenant_id, request_id, run_id, pickup_time, ref)
                return self._trip(t)
        return await protected_write(ctx, self.system, "book_request", idempotency_key, call)

    async def cancel_booking(self, ctx, *, request_id, idempotency_key):
        async def call():
            async with product_session() as s:
                t = await tm.cancel_booking(s, ctx.tenant_id, request_id)
                return {"request_id": request_id, "trip_id": t.id if t else None, "cancelled": bool(t)}
        return await protected_write(ctx, self.system, "cancel_booking", idempotency_key, call)

    async def rider_no_show_count(self, ctx, rider_id, days):
        async with SessionLocal() as s:
            return await tm.rider_no_show_count(s, ctx.tenant_id, rider_id, days)


class MockWorkforceAdapter(WorkforceAdapter):
    async def drivers(self, ctx):
        async with SessionLocal() as s:
            emap = await identity.map_for_system(s, ctx.tenant_id, self.system, "driver")
            return [{"driver_id": emap.get(e.employee_number), "employee_number": e.employee_number, "name": e.full_name,
                     "license_class": e.license_class, "certifications": e.certifications, "status": e.status,
                     "home_depot": e.home_depot, "max_daily_hours": e.max_daily_hours}
                    for e in await wf.list_employees(s, ctx.tenant_id)]


class MockRiderCommsAdapter(RiderCommsAdapter):
    async def send_notification(self, ctx, *, rider_id, trip_id, kind, message, idempotency_key):
        async def call():
            async with product_session() as s:
                n = await rc.send(s, ctx.tenant_id, rider_id=rider_id, trip_id=trip_id, kind=kind, message=message,
                                  workflow_id=ctx.workflow_id, idempotency_key=idempotency_key)
                return {"notification_id": n.id, "channel": n.channel, "status": n.status}
        return await protected_write(ctx, self.system, "send", idempotency_key, call)


class MockSafetyAdapter(SafetyAdapter):
    async def driver_compliance(self, ctx, driver_ids, on):
        async with SessionLocal() as s:
            out = {}
            for cid in driver_ids:
                sid = await identity.to_external(s, ctx.tenant_id, cid, self.system) if cid else None
                d = await s.get(sf.SafetyDriver, sid) if sid else None
                if d and d.tenant_id == ctx.tenant_id:
                    out[cid] = sf.compliance(d, on)
            return out

    async def open_defects(self, ctx, vehicle_id):
        async with SessionLocal() as s:
            ref = await identity.to_external(s, ctx.tenant_id, vehicle_id, self.system)
            if not ref:
                return []
            return [{"defect_id": d.id, "category": d.category, "severity": d.severity, "description": d.description, "source": d.source,
                     "created_at": _iso(d.created_at)} for d in await sf.list_defects(s, ctx.tenant_id, "open", ref)]

    async def open_defect(self, ctx, *, vehicle_id, category, severity, description, work_order_id, idempotency_key):
        async def call():
            async with product_session() as s:
                ref = await _ext(s, ctx, vehicle_id, self.system)
                d = await sf.open_defect(s, ctx.tenant_id, vehicle_ref=ref, category=category, severity=severity, description=description,
                                         source="orchestrator", external_ref=ctx.workflow_id, work_order_id=work_order_id, created_by=ctx.actor)
                return {"defect_id": d.id, "vehicle_ref": ref, "status": d.status, "out_of_service": d.out_of_service}
        return await protected_write(ctx, self.system, "open_defect", idempotency_key, call)

    async def close_defect(self, ctx, *, defect_id, resolution, idempotency_key):
        async def call():
            async with product_session() as s:
                d = await sf.close_defect(s, ctx.tenant_id, defect_id, ctx.actor, resolution)
                return {"defect_id": d.id, "status": d.status}
        return await protected_write(ctx, self.system, "close_defect", idempotency_key, call)
