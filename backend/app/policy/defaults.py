"""Default autonomy policy. Tenants override any part of it from the Policies screen."""

LEVELS = ("informational", "shadow", "semi_autonomous", "autonomous")
# shadow: the agent works out exactly what it would do and records it, but takes no action and asks no one.
# People keep working in the products as today; the Shadow mode screen compares their actions with the agent's.
MODES = ("live", "shadow")  # workflow-level switch: shadow forces every write step to the shadow level

VEHICLE_HEALTH_STEPS = [
    ("detect", "Detect", "Fault or overdue maintenance flag received"),
    ("assess", "Assess", "Severity, runs at risk and spare vehicles evaluated"),
    ("open_work_order", "Open work order", "Work order created in asset management"),
    ("pull_vehicle", "Pull vehicle", "Vehicle marked unavailable in the schedule"),
    ("reassign_runs", "Reassign runs", "Spare vehicle and qualified driver put on affected runs"),
    ("notify_riders", "Notify riders", "Updated ETAs sent to affected riders"),
    ("return_to_service", "Return to service", "Vehicle back on the schedule after the work order closes"),
]

NO_SHOW_STEPS = [
    ("detect", "Detect", "No-show or late cancellation recorded"),
    ("assess", "Assess", "Time freed, run delay, standby riders and downstream pickups evaluated"),
    ("adjust_schedule", "Adjust schedule", "Standby rider booked into the gap, or later pickups moved earlier"),
    ("notify_riders", "Notify riders", "Riders told about earlier pickups or a new booking"),
    ("close", "Log recovery", "Capacity recovered and on-time effect recorded"),
]

STEPS_BY_TYPE = {"vehicle_health": VEHICLE_HEALTH_STEPS, "no_show_recovery": NO_SHOW_STEPS}
WORKFLOW_NAMES = {"vehicle_health": "Vehicle health to service continuity", "no_show_recovery": "No-show recovery"}

NO_SHOW_PERMISSIONS = [
    "trip_mgmt.book_request",
    "trip_mgmt.cancel_booking",
    "trip_mgmt.update_trip_eta",
    "rider_comms.send",
]

AGENT_PERMISSIONS = [
    "asset_mgmt.create_work_order",
    "asset_mgmt.cancel_work_order",
    "safety.open_defect",
    "safety.close_defect",
    "trip_mgmt.block_vehicle",
    "trip_mgmt.unblock_vehicle",
    "trip_mgmt.assign_run",
    "trip_mgmt.revert_run",
    "trip_mgmt.update_trip_eta",
    "rider_comms.send",
]

# What each persona may do in the products. An agent action runs with the permissions of the persona it
# serves: the person who approved the step, or the step's `acts_as` persona when the agent acts under policy.
# The effective permission set is (agent_permissions AND persona permissions), so the agent can never do
# more than the person it is acting for. Tenants can edit this per workflow on the Autonomy policy screen.
PERSONA_PERMISSIONS = {
    "dispatcher": [
        "asset_mgmt.create_work_order", "trip_mgmt.block_vehicle", "trip_mgmt.unblock_vehicle", "trip_mgmt.assign_run",
        "trip_mgmt.revert_run", "trip_mgmt.update_trip_eta", "trip_mgmt.book_request", "trip_mgmt.cancel_booking",
        "rider_comms.send", "safety.open_defect",
    ],
    "shop_manager": [
        "asset_mgmt.create_work_order", "asset_mgmt.cancel_work_order", "trip_mgmt.unblock_vehicle",
        "safety.open_defect", "safety.close_defect",
    ],
    "admin": ["*"],
    "viewer": [],
}
ALL_PERMISSIONS = sorted({p for perms in PERSONA_PERMISSIONS.values() for p in perms if p != "*"} | {"asset_mgmt.cancel_work_order", "safety.close_defect"})

DEFAULT_RULES = {
    "vehicle_health": {
        "steps": {
            "detect": {"level": "autonomous", "approver_roles": []},
            "assess": {"level": "autonomous", "approver_roles": []},
            "open_work_order": {
                "level": "semi_autonomous",
                "approver_roles": ["dispatcher", "shop_manager"],
                "by_severity": {"low": "informational"},
                "acts_as": "shop_manager",
            },
            "pull_vehicle": {"level": "semi_autonomous", "approver_roles": ["dispatcher"], "acts_as": "dispatcher"},
            "reassign_runs": {"level": "semi_autonomous", "approver_roles": ["dispatcher"], "acts_as": "dispatcher"},
            "notify_riders": {"level": "autonomous", "approver_roles": ["dispatcher"], "acts_as": "dispatcher"},
            "return_to_service": {"level": "autonomous", "approver_roles": ["dispatcher", "shop_manager"], "acts_as": "shop_manager"},
        },
        "mode": "live",
        "thresholds": {
            "service_window_hours": 48,
            "pm_high_severity_miles_over": 1500,
            "max_spare_candidates": 3,
            "swap_delay_same_depot_min": 8,
            "swap_delay_other_depot_min": 22,
            "delay_applies_within_minutes_of_run_start": 90,
        },
        "compensation": {
            "restore_vehicle_on_reassign_failure": True,
            "cancel_work_order_on_failure": False,
        },
        "safety": {
            # Faults on these systems are also logged as a vehicle defect in Safety & Compliance (Vestige).
            "defect_systems": ["Brakes", "Accessibility"],
            "defect_min_severity": "critical",  # any fault at or above this severity is logged too
            "exclude_noncompliant_drivers": True,  # drivers Vestige marks non-compliant are never proposed
        },
        "agent_permissions": AGENT_PERMISSIONS,
        "persona_permissions": PERSONA_PERMISSIONS,
    },
    "no_show_recovery": {
        "steps": {
            "detect": {"level": "autonomous", "approver_roles": []},
            "assess": {"level": "autonomous", "approver_roles": []},
            "adjust_schedule": {"level": "semi_autonomous", "approver_roles": ["dispatcher"], "acts_as": "dispatcher"},
            "notify_riders": {"level": "autonomous", "approver_roles": ["dispatcher"], "acts_as": "dispatcher"},
            "close": {"level": "autonomous", "approver_roles": []},
        },
        "mode": "live",
        "thresholds": {
            "no_show_minutes_saved": 8,
            "late_cancel_minutes_saved": 11,
            "late_threshold_min": 10,
            "max_insert_extra_min": 6,
            "notify_if_eta_change_min": 3,
            "no_show_review_threshold_30d": 3,
            "max_standby_candidates": 3,
        },
        "compensation": {"cancel_booking_on_failure": True},
        "agent_permissions": NO_SHOW_PERMISSIONS,
        "persona_permissions": PERSONA_PERMISSIONS,
    },
}
PERMISSIONS_BY_TYPE = {"vehicle_health": AGENT_PERMISSIONS, "no_show_recovery": NO_SHOW_PERMISSIONS}
