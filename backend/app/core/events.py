"""Canonical event schema (CloudEvents 1.0 shape) and the event-type catalog."""
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.core.clock import new_id, now


class EventTypes:
    # Published by products
    VEHICLE_FAULT_DETECTED = "vehicle.fault.detected"        # telematics
    VEHICLE_PM_OVERDUE = "vehicle.pm.overdue"                # asset mgmt
    WORK_ORDER_CREATED = "workorder.created"                 # asset mgmt
    WORK_ORDER_CLOSED = "workorder.closed"                   # asset mgmt
    WORK_ORDER_CANCELLED = "workorder.cancelled"             # asset mgmt
    VEHICLE_AVAILABILITY_CHANGED = "vehicle.availability.changed"  # trip mgmt
    RUN_REASSIGNED = "run.reassigned"                        # trip mgmt
    TRIP_NO_SHOW = "trip.no_show"                            # trip mgmt -> No-Show Recovery
    TRIP_CANCELLED = "trip.cancelled"                        # trip mgmt (late cancellation) -> No-Show Recovery
    TRIP_BOOKED = "trip.booked"                              # trip mgmt (standby rider booked)
    RIDER_NOTIFIED = "rider.notified"                        # rider comms
    SAFETY_DEFECT_OPENED = "safety.defect.opened"            # safety & compliance (Vestige)
    SAFETY_DEFECT_CLOSED = "safety.defect.closed"            # safety & compliance (Vestige)
    DRIVER_COMPLIANCE_CHANGED = "safety.driver.compliance_changed"  # safety & compliance (Vestige)
    # Internal orchestration commands
    APPROVAL_DECIDED = "orchestrator.approval.decided"
    WORKFLOW_STATUS_CHANGED = "orchestrator.workflow.status_changed"

    CATALOG: dict[str, dict] = {
        VEHICLE_FAULT_DETECTED: {"source": "telematics", "triggers": "vehicle_health", "description": "A diagnostic trouble code was reported by a vehicle."},
        VEHICLE_PM_OVERDUE: {"source": "asset_mgmt", "triggers": "vehicle_health", "description": "A vehicle passed its preventive maintenance interval."},
        WORK_ORDER_CREATED: {"source": "asset_mgmt", "triggers": None, "description": "A work order was opened."},
        WORK_ORDER_CLOSED: {"source": "asset_mgmt", "triggers": "resume", "description": "A work order was closed by the shop."},
        WORK_ORDER_CANCELLED: {"source": "asset_mgmt", "triggers": None, "description": "A work order was cancelled."},
        VEHICLE_AVAILABILITY_CHANGED: {"source": "trip_mgmt", "triggers": None, "description": "A vehicle was pulled from or returned to the schedule."},
        RUN_REASSIGNED: {"source": "trip_mgmt", "triggers": None, "description": "A run got a different vehicle or driver."},
        TRIP_NO_SHOW: {"source": "trip_mgmt", "triggers": "no_show_recovery", "description": "A rider did not show up for a booked pickup."},
        TRIP_CANCELLED: {"source": "trip_mgmt", "triggers": "no_show_recovery", "description": "A rider cancelled a booked trip at short notice."},
        TRIP_BOOKED: {"source": "trip_mgmt", "triggers": None, "description": "A standby rider was booked onto a run."},
        RIDER_NOTIFIED: {"source": "rider_comms", "triggers": None, "description": "A rider notification was sent."},
        SAFETY_DEFECT_OPENED: {"source": "safety", "triggers": None, "description": "A vehicle defect was recorded in Safety & Compliance."},
        SAFETY_DEFECT_CLOSED: {"source": "safety", "triggers": None, "description": "A vehicle defect was cleared in Safety & Compliance."},
        DRIVER_COMPLIANCE_CHANGED: {"source": "safety", "triggers": None,
                                    "description": "A driver's compliance changed (medical card, drug test, training, suspension)."},
        APPROVAL_DECIDED: {"source": "orchestrator", "triggers": "resume", "description": "A person decided on a pending agent action."},
        WORKFLOW_STATUS_CHANGED: {"source": "orchestrator", "triggers": None, "description": "A workflow changed status."},
    }


class CloudEvent(BaseModel):
    id: str = Field(default_factory=lambda: new_id("evt"))
    specversion: str = "1.0"
    type: str
    source: str
    subject: Optional[str] = None  # canonical entity id, e.g. veh_...
    time: datetime = Field(default_factory=now)
    tenantid: str
    datacontenttype: str = "application/json"
    data: dict[str, Any] = Field(default_factory=dict)
    dedupekey: Optional[str] = None  # same key within the window = duplicate
    correlationid: Optional[str] = None  # workflow id when known
    traceid: Optional[str] = None
