"""Typed adapter interfaces. Agents only ever talk to products through these.

All IDs crossing this boundary are canonical (veh_/drv_/trp_), and all return
values are plain JSON-safe dicts so they can live in checkpointed workflow state.
Implementations translate to product-specific IDs via the identity service.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Optional


@dataclass
class ActionContext:
    tenant_id: str
    actor: str  # the agent persona or the human acting
    workflow_id: Optional[str] = None
    trace_id: Optional[str] = None
    allowed_actions: set[str] = field(default_factory=set)  # empty = read-only


class AssetAdapter(ABC):
    system = "asset_mgmt"

    @abstractmethod
    async def vehicle_health(self, ctx: ActionContext, vehicle_id: str) -> dict[str, Any]: ...
    @abstractmethod
    async def fault_code(self, ctx: ActionContext, code: str) -> Optional[dict[str, Any]]: ...
    @abstractmethod
    async def find_shop_window(self, ctx: ActionContext, vehicle_id: str, earliest: datetime, est_hours: int, immediate: bool) -> dict[str, Any]: ...
    @abstractmethod
    async def create_work_order(self, ctx: ActionContext, *, vehicle_id: str, priority: str, title: str, description: str,
                                fault_code: Optional[str], shop_start: datetime, shop_end: datetime, idempotency_key: str) -> dict[str, Any]: ...
    @abstractmethod
    async def cancel_work_order(self, ctx: ActionContext, work_order_id: str, reason: str) -> dict[str, Any]: ...
    @abstractmethod
    async def get_work_order(self, ctx: ActionContext, work_order_id: str) -> dict[str, Any]: ...


class TripAdapter(ABC):
    system = "trip_mgmt"

    @abstractmethod
    async def vehicle(self, ctx: ActionContext, vehicle_id: str) -> dict[str, Any]: ...
    @abstractmethod
    async def fleet(self, ctx: ActionContext) -> list[dict[str, Any]]: ...
    @abstractmethod
    async def runs_for_vehicle(self, ctx: ActionContext, vehicle_id: str, start: datetime, end: datetime) -> list[dict[str, Any]]: ...
    @abstractmethod
    async def runs_between(self, ctx: ActionContext, start: datetime, end: datetime) -> list[dict[str, Any]]: ...
    @abstractmethod
    async def blocks_between(self, ctx: ActionContext, start: datetime, end: datetime) -> list[dict[str, Any]]: ...
    @abstractmethod
    async def block_vehicle(self, ctx: ActionContext, *, vehicle_id: str, start: datetime, end: datetime, reason: str, ref: str, idempotency_key: str) -> dict[str, Any]: ...
    @abstractmethod
    async def unblock_vehicle(self, ctx: ActionContext, *, ref: str, reason: str, idempotency_key: str) -> dict[str, Any]: ...
    @abstractmethod
    async def assign_run(self, ctx: ActionContext, *, run_id: str, vehicle_id: str, driver_id: str, ref: str, idempotency_key: str) -> dict[str, Any]: ...
    @abstractmethod
    async def revert_run(self, ctx: ActionContext, *, run_id: str, idempotency_key: str) -> dict[str, Any]: ...
    @abstractmethod
    async def trips_for_runs(self, ctx: ActionContext, run_ids: list[str]) -> list[dict[str, Any]]: ...
    @abstractmethod
    async def update_trip_eta(self, ctx: ActionContext, *, trip_id: str, eta: datetime, idempotency_key: str) -> dict[str, Any]: ...

    # --- used by No-Show Recovery ---
    @abstractmethod
    async def get_trip(self, ctx: ActionContext, trip_id: str) -> dict[str, Any]: ...
    @abstractmethod
    async def run_detail(self, ctx: ActionContext, run_id: str) -> dict[str, Any]:
        """Run with vehicle, driver, current delay and its booked trips."""
    @abstractmethod
    async def waitlist_candidates(self, ctx: ActionContext, run_id: str, start: datetime, end: datetime) -> list[dict[str, Any]]: ...
    @abstractmethod
    async def book_request(self, ctx: ActionContext, *, request_id: str, run_id: str, pickup_time: datetime, ref: str, idempotency_key: str) -> dict[str, Any]: ...
    @abstractmethod
    async def cancel_booking(self, ctx: ActionContext, *, request_id: str, idempotency_key: str) -> dict[str, Any]: ...
    @abstractmethod
    async def rider_no_show_count(self, ctx: ActionContext, rider_id: str, days: int) -> int: ...


class WorkforceAdapter(ABC):
    system = "workforce"

    @abstractmethod
    async def drivers(self, ctx: ActionContext) -> list[dict[str, Any]]: ...


class RiderCommsAdapter(ABC):
    system = "rider_comms"

    @abstractmethod
    async def send_notification(self, ctx: ActionContext, *, rider_id: str, trip_id: Optional[str], kind: str, message: str, idempotency_key: str) -> dict[str, Any]: ...


class SafetyAdapter(ABC):
    system = "safety"

    @abstractmethod
    async def driver_compliance(self, ctx: ActionContext, driver_ids: list[str], on: date) -> dict[str, dict[str, Any]]:
        """driver_id -> {compliant, blocking[], wheelchair_ok, wheelchair_reasons[]}. Unknown drivers are omitted."""
    @abstractmethod
    async def open_defects(self, ctx: ActionContext, vehicle_id: str) -> list[dict[str, Any]]: ...
    @abstractmethod
    async def open_defect(self, ctx: ActionContext, *, vehicle_id: str, category: str, severity: str, description: str,
                          work_order_id: Optional[str], idempotency_key: str) -> dict[str, Any]: ...
    @abstractmethod
    async def close_defect(self, ctx: ActionContext, *, defect_id: str, resolution: str, idempotency_key: str) -> dict[str, Any]: ...
