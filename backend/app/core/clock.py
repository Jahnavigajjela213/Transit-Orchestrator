"""Single place for 'now' and ID generation.

All datetimes are naive wall-clock time in the agency's time zone (US Eastern),
whatever zone the server or the browser runs in. Keeping them naive keeps
schedules readable (a 06:00 run shows as 06:00 ET). Switch to timezone-aware
UTC when deploying multi-region.
"""
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

AGENCY_TZ = ZoneInfo("America/New_York")


def now() -> datetime:
    return datetime.now(AGENCY_TZ).replace(tzinfo=None, microsecond=0)


def precise_now() -> datetime:
    """Microsecond precision, for ordering audit records and events written in the same second."""
    return datetime.now(AGENCY_TZ).replace(tzinfo=None)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"
