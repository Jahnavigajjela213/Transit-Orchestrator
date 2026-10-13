"""Picks mock or real adapters based on ADAPTER_MODE."""
from dataclasses import dataclass

from app.adapters.base import AssetAdapter, RiderCommsAdapter, SafetyAdapter, TripAdapter, WorkforceAdapter
from app.core.config import settings


@dataclass
class Adapters:
    asset: AssetAdapter
    trip: TripAdapter
    workforce: WorkforceAdapter
    rider_comms: RiderCommsAdapter
    safety: SafetyAdapter


def build_adapters() -> Adapters:
    if settings.adapter_mode == "http":
        from app.adapters.http import HttpAssetAdapter, HttpRiderCommsAdapter, HttpSafetyAdapter, HttpTripAdapter, HttpWorkforceAdapter

        return Adapters(HttpAssetAdapter(), HttpTripAdapter(), HttpWorkforceAdapter(), HttpRiderCommsAdapter(), HttpSafetyAdapter())
    from app.adapters.mock import MockAssetAdapter, MockRiderCommsAdapter, MockSafetyAdapter, MockTripAdapter, MockWorkforceAdapter

    return Adapters(MockAssetAdapter(), MockTripAdapter(), MockWorkforceAdapter(), MockRiderCommsAdapter(), MockSafetyAdapter())


adapters = build_adapters()
