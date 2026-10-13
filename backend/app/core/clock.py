"""Single place for 'now' and ID generation.

All datetimes are naive *local* time. The demo runs on one machine, so the
browser and server share a clock; this keeps schedules readable (a 06:00 run
shows as 06:00). Switch to timezone-aware UTC when deploying multi-region.
"""
import uuid
from datetime import datetime


def now() -> datetime:
    return datetime.now().replace(microsecond=0)


def precise_now() -> datetime:
    """Microsecond precision, for ordering audit records and events written in the same second."""
    return datetime.now()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"
