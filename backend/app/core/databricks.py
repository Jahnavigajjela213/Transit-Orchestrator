"""Databricks connection settings shared by the reader (pages) and the sync (Postgres -> Databricks)."""
import json
from functools import lru_cache
from urllib.parse import quote

from app.core.config import settings

# Product and analytics tables kept in Databricks (proposal data categories 1-7), plus the decision audit log.
# Pages read these from Databricks when READ_SOURCE=databricks; app/sync/databricks.py keeps them current.
PRODUCT_TABLES = (
    # shared identity
    "tenants", "canonical_entities", "identity_crosswalk",
    # 1. vehicle health and telematics
    "tl_devices", "tl_readings", "am_fault_codes", "events",
    # 2. asset and maintenance status (FASTER)
    "am_assets", "am_work_orders", "am_shop_capacity", "tm_availability_blocks",
    # 3. trip and schedule data (Ecolane / TripMaster)
    "tm_vehicles", "tm_drivers", "tm_runs", "tm_trips", "tm_trip_requests", "tm_no_show_log",
    # 4. driver and workforce (Bytecurve)
    "wf_employees",
    # 5. safety and compliance (Vestige)
    "sf_drivers", "sf_defects",
    # 6. rider communications (TripShot / Passio)
    "rc_riders", "rc_notifications",
    # 7. operational history and analytics
    "an_run_history", "an_models",
)
# Derived from the audit log in Postgres and synced like the product tables: embeddings for the assistant's semantic search.
DERIVED_TABLES = ("audit_embeddings",)
SYNCED_TABLES = PRODUCT_TABLES + DERIVED_TABLES  # copied by app/sync/databricks.py
AUDIT_TABLE = "audit_records"  # written by the audit mirror (app/audit/sinks.py), read like the others
DATABRICKS_TABLES = frozenset(SYNCED_TABLES + (AUDIT_TABLE,))


def host() -> str:
    return settings.databricks_host or settings.databricks_server_hostname


def qualified(table: str) -> str:
    return f"{settings.databricks_catalog}.{settings.databricks_schema}.{table}"


def _check() -> None:
    if not (host() and settings.databricks_http_path and settings.databricks_token):
        raise RuntimeError("Databricks is not configured. Set DATABRICKS_SERVER_HOSTNAME, DATABRICKS_HTTP_PATH and DATABRICKS_TOKEN.")


def connect():
    """Raw DB-API connection (used by the sync)."""
    from databricks import sql  # type: ignore

    _check()
    return sql.connect(server_hostname=host(), http_path=settings.databricks_http_path, access_token=settings.databricks_token,
                       _socket_timeout=120)


def _json_loads(value):
    # rows written by hand in Databricks may hold plain text in a JSON column: return it as-is
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return value


@lru_cache
def read_engine():
    """SQLAlchemy engine on the Databricks SQL warehouse, so the app's own queries run unchanged against it."""
    from sqlalchemy import create_engine

    _check()
    url = (f"databricks://token:{quote(settings.databricks_token, safe='')}@{host()}"
           f"?http_path={quote(settings.databricks_http_path, safe='')}"
           f"&catalog={settings.databricks_catalog}&schema={settings.databricks_schema}")
    eng = create_engine(url, pool_size=5, max_overflow=10, pool_recycle=900)
    # the Databricks dialect does not define these; SQLAlchemy's JSON type needs them to decode STRING columns
    eng.dialect._json_deserializer = _json_loads
    eng.dialect._json_serializer = json.dumps
    return eng
