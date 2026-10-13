"""Adapters that call the real product APIs over HTTP (ADAPTER_MODE=http).

The endpoint paths below are a template: align them with each vendor's API
documentation during Phase 0. The rest of the system does not change - the
orchestrator only depends on the interfaces in adapters/base.py.

Transient errors (timeouts, 429, 5xx) are flagged so protected_write retries them.
"""
from datetime import datetime
from typing import Any, Optional

import httpx

from app.adapters.base import ActionContext, AssetAdapter, RiderCommsAdapter, SafetyAdapter, TripAdapter, WorkforceAdapter
from app.adapters.resilience import protected_write
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.errors import ProductAPIError
from app.identity.service import identity


class _Client:
    def __init__(self, system: str, base_url: str, api_key: str):
        self.system = system
        self.base_url = base_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

    async def request(self, method: str, path: str, *, action: str, json: Any = None, params: Any = None, idem: Optional[str] = None) -> Any:
        headers = dict(self.headers)
        if idem:
            headers["Idempotency-Key"] = idem
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.request(method, f"{self.base_url}{path}", json=json, params=params, headers=headers)
        except (httpx.TimeoutException, httpx.NetworkError) as e:
            raise ProductAPIError(self.system, action, str(e), transient=True)
        if r.status_code == 429 or r.status_code >= 500:
            raise ProductAPIError(self.system, action, f"HTTP {r.status_code}", transient=True)
        if r.status_code >= 400:
            raise ProductAPIError(self.system, action, f"HTTP {r.status_code}: {r.text[:200]}")
        return r.json() if r.content else {}


async def _ext(ctx: ActionContext, canonical_id: str, system: str) -> str:
    async with SessionLocal() as s:
        ext = await identity.to_external(s, ctx.tenant_id, canonical_id, system)
    if not ext:
        raise ProductAPIError(system, "identity", f"No {system} id mapped for {canonical_id}")
    return ext


async def _canon(ctx: ActionContext, system: str, external_id: Optional[str]) -> Optional[str]:
    if not external_id:
        return None
    async with SessionLocal() as s:
        return await identity.to_canonical(s, ctx.tenant_id, system, external_id)


class HttpAssetAdapter(AssetAdapter):
    def __init__(self):
        self.c = _Client(self.system, settings.asset_api_base_url, settings.asset_api_key)

    async def vehicle_health(self, ctx, vehicle_id):
        asset = await _ext(ctx, vehicle_id, self.system)
        return await self.c.request("GET", f"/assets/{asset}/health", action="vehicle_health")

    async def fault_code(self, ctx, code):
        return await self.c.request("GET", f"/fault-codes/{code}", action="fault_code")

    async def find_shop_window(self, ctx, vehicle_id, earliest, est_hours, immediate):
        asset = await _ext(ctx, vehicle_id, self.system)
        return await self.c.request("GET", "/shop/availability", action="find_shop_window",
                                    params={"asset": asset, "earliest": earliest.isoformat(), "hours": est_hours, "immediate": immediate})

    async def create_work_order(self, ctx, *, vehicle_id, priority, title, description, fault_code, shop_start, shop_end, idempotency_key):
        asset = await _ext(ctx, vehicle_id, self.system)
        body = {"asset_number": asset, "priority": priority, "title": title, "description": description, "fault_code": fault_code,
                "shop_start": shop_start.isoformat(), "shop_end": shop_end.isoformat(), "external_ref": ctx.workflow_id}
        return await protected_write(ctx, self.system, "create_work_order", idempotency_key,
                                     lambda: self.c.request("POST", "/work-orders", action="create_work_order", json=body, idem=idempotency_key))

    async def cancel_work_order(self, ctx, work_order_id, reason):
        key = f"{ctx.workflow_id}:cancel_wo:{work_order_id}"
        return await protected_write(ctx, self.system, "cancel_work_order", key,
                                     lambda: self.c.request("POST", f"/work-orders/{work_order_id}/cancel", action="cancel_work_order", json={"reason": reason}, idem=key))

    async def get_work_order(self, ctx, work_order_id):
        return await self.c.request("GET", f"/work-orders/{work_order_id}", action="get_work_order")


class HttpTripAdapter(TripAdapter):
    def __init__(self):
        self.c = _Client(self.system, settings.trip_api_base_url, settings.trip_api_key)

    async def vehicle(self, ctx, vehicle_id):
        code = await _ext(ctx, vehicle_id, self.system)
        v = await self.c.request("GET", f"/vehicles/{code}", action="vehicle")
        return {**v, "vehicle_id": vehicle_id, "vehicle_code": code}

    async def fleet(self, ctx):
        rows = await self.c.request("GET", "/vehicles", action="fleet")
        return [{**v, "vehicle_id": await _canon(ctx, self.system, v.get("vehicle_code"))} for v in rows]

    async def _canon_run(self, ctx, r):
        return {**r, "vehicle_id": await _canon(ctx, self.system, r.get("vehicle_code")), "driver_id": await _canon(ctx, self.system, r.get("driver_code"))}

    async def runs_for_vehicle(self, ctx, vehicle_id, start, end):
        code = await _ext(ctx, vehicle_id, self.system)
        rows = await self.c.request("GET", "/runs", action="runs_for_vehicle", params={"vehicle": code, "from": start.isoformat(), "to": end.isoformat()})
        return [await self._canon_run(ctx, r) for r in rows]

    async def runs_between(self, ctx, start, end):
        rows = await self.c.request("GET", "/runs", action="runs_between", params={"from": start.isoformat(), "to": end.isoformat()})
        return [await self._canon_run(ctx, r) for r in rows]

    async def blocks_between(self, ctx, start, end):
        rows = await self.c.request("GET", "/availability-blocks", action="blocks_between", params={"from": start.isoformat(), "to": end.isoformat()})
        return [{**b, "vehicle_id": await _canon(ctx, self.system, b.get("vehicle_code"))} for b in rows]

    async def block_vehicle(self, ctx, *, vehicle_id, start, end, reason, ref, idempotency_key):
        code = await _ext(ctx, vehicle_id, self.system)
        body = {"vehicle_code": code, "from": start.isoformat(), "until": end.isoformat(), "reason": reason, "ref": ref}
        return await protected_write(ctx, self.system, "block_vehicle", idempotency_key,
                                     lambda: self.c.request("POST", "/availability-blocks", action="block_vehicle", json=body, idem=idempotency_key))

    async def unblock_vehicle(self, ctx, *, ref, reason, idempotency_key):
        return await protected_write(ctx, self.system, "unblock_vehicle", idempotency_key,
                                     lambda: self.c.request("POST", f"/availability-blocks/{ref}/release", action="unblock_vehicle", json={"reason": reason}, idem=idempotency_key))

    async def assign_run(self, ctx, *, run_id, vehicle_id, driver_id, ref, idempotency_key):
        body = {"vehicle_code": await _ext(ctx, vehicle_id, self.system), "driver_code": await _ext(ctx, driver_id, self.system), "ref": ref}
        return await protected_write(ctx, self.system, "assign_run", idempotency_key,
                                     lambda: self.c.request("PUT", f"/runs/{run_id}/assignment", action="assign_run", json=body, idem=idempotency_key))

    async def revert_run(self, ctx, *, run_id, idempotency_key):
        return await protected_write(ctx, self.system, "revert_run", idempotency_key,
                                     lambda: self.c.request("POST", f"/runs/{run_id}/assignment/revert", action="revert_run", idem=idempotency_key))

    async def trips_for_runs(self, ctx, run_ids):
        return await self.c.request("GET", "/trips", action="trips_for_runs", params={"runs": ",".join(run_ids)})

    async def update_trip_eta(self, ctx, *, trip_id, eta, idempotency_key):
        return await protected_write(ctx, self.system, "update_trip_eta", idempotency_key,
                                     lambda: self.c.request("PATCH", f"/trips/{trip_id}", action="update_trip_eta", json={"eta": eta.isoformat()}, idem=idempotency_key))


    # --- No-Show Recovery ---
    async def get_trip(self, ctx, trip_id):
        return await self.c.request("GET", f"/trips/{trip_id}", action="get_trip")

    async def run_detail(self, ctx, run_id):
        r = await self.c.request("GET", f"/runs/{run_id}", action="run_detail", params={"include": "trips,vehicle,driver"})
        return await self._canon_run(ctx, r)

    async def waitlist_candidates(self, ctx, run_id, start, end):
        return await self.c.request("GET", "/trip-requests", action="waitlist_candidates",
                                    params={"run": run_id, "from": start.isoformat(), "to": end.isoformat(), "status": "waiting"})

    async def book_request(self, ctx, *, request_id, run_id, pickup_time, ref, idempotency_key):
        body = {"run_id": run_id, "pickup_time": pickup_time.isoformat(), "ref": ref}
        return await protected_write(ctx, self.system, "book_request", idempotency_key,
                                     lambda: self.c.request("POST", f"/trip-requests/{request_id}/book", action="book_request", json=body, idem=idempotency_key))

    async def cancel_booking(self, ctx, *, request_id, idempotency_key):
        return await protected_write(ctx, self.system, "cancel_booking", idempotency_key,
                                     lambda: self.c.request("POST", f"/trip-requests/{request_id}/unbook", action="cancel_booking", idem=idempotency_key))

    async def rider_no_show_count(self, ctx, rider_id, days):
        r = await self.c.request("GET", f"/riders/{rider_id}/no-shows", action="rider_no_show_count", params={"days": days})
        return int(r.get("count", 0))


class HttpWorkforceAdapter(WorkforceAdapter):
    def __init__(self):
        self.c = _Client(self.system, settings.workforce_api_base_url, settings.workforce_api_key)

    async def drivers(self, ctx):
        rows = await self.c.request("GET", "/employees", action="drivers", params={"role": "operator"})
        return [{**e, "driver_id": await _canon(ctx, self.system, e.get("employee_number"))} for e in rows]


class HttpRiderCommsAdapter(RiderCommsAdapter):
    def __init__(self):
        self.c = _Client(self.system, settings.rider_comms_api_base_url, settings.rider_comms_api_key)

    async def send_notification(self, ctx, *, rider_id, trip_id, kind, message, idempotency_key):
        body = {"rider_id": rider_id, "trip_id": trip_id, "kind": kind, "message": message, "ref": ctx.workflow_id}
        return await protected_write(ctx, self.system, "send", idempotency_key,
                                     lambda: self.c.request("POST", "/notifications", action="send", json=body, idem=idempotency_key))


class HttpSafetyAdapter(SafetyAdapter):
    """Vestige. Align paths with the Vestige API during Phase 0."""

    def __init__(self):
        self.c = _Client(self.system, settings.safety_api_base_url, settings.safety_api_key)

    async def driver_compliance(self, ctx, driver_ids, on):
        ext = {}
        for cid in driver_ids:
            async with SessionLocal() as s:
                sid = await identity.to_external(s, ctx.tenant_id, cid, self.system)
            if sid:
                ext[sid] = cid
        if not ext:
            return {}
        rows = await self.c.request("GET", "/drivers/compliance", action="driver_compliance", params={"ids": ",".join(ext), "on": on.isoformat()})
        return {ext[r["safety_id"]]: r for r in rows if r.get("safety_id") in ext}

    async def open_defects(self, ctx, vehicle_id):
        ref = await _ext(ctx, vehicle_id, self.system)
        return await self.c.request("GET", "/defects", action="open_defects", params={"vehicle": ref, "status": "open"})

    async def open_defect(self, ctx, *, vehicle_id, category, severity, description, work_order_id, idempotency_key):
        ref = await _ext(ctx, vehicle_id, self.system)
        body = {"vehicle_ref": ref, "category": category, "severity": severity, "description": description,
                "work_order_id": work_order_id, "external_ref": ctx.workflow_id}
        return await protected_write(ctx, self.system, "open_defect", idempotency_key,
                                     lambda: self.c.request("POST", "/defects", action="open_defect", json=body, idem=idempotency_key))

    async def close_defect(self, ctx, *, defect_id, resolution, idempotency_key):
        return await protected_write(ctx, self.system, "close_defect", idempotency_key,
                                     lambda: self.c.request("POST", f"/defects/{defect_id}/close", action="close_defect",
                                                            json={"resolution": resolution}, idem=idempotency_key))
