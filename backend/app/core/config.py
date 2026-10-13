"""Application settings, loaded from environment variables / .env file."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(BACKEND_DIR / ".env"), extra="ignore")

    # App
    app_name: str = "TransitTechOS Orchestrator"
    environment: str = "local"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    jwt_secret: str = "change-me-in-real-deployments"
    jwt_expire_minutes: int = 720
    log_level: str = "INFO"
    ingest_api_key: str = "local-ingest-key"  # products POST events to /api/events/ingest with X-Ingest-Key

    # Sign-in: local (demo JWT) | gcip (Google Cloud Identity Platform ID tokens, exchanged for an app session)
    auth_mode: str = "local"
    gcip_project_id: str = ""
    gcip_api_key: str = ""  # Web API key, used by the sign-in screen to call Identity Platform
    gcip_tenant_map: str = ""  # "<gcip tenant id>:<app tenant id>,..." for multi-tenant Identity Platform
    gcip_auto_provision: bool = False  # create a user row on first GCIP sign-in (role from the "role" custom claim)

    # Storage
    # PostgreSQL by default. SQLite still works: sqlite+aiosqlite:///./data/transit.db
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/transit_orchestrator"
    db_auto_create: bool = True  # create the database on first start if it does not exist
    checkpoint_db_path: str = str(BACKEND_DIR / "data" / "checkpoints.db")  # only used with SQLite
    test_database_url: str = ""  # pytest reads this (or TEST_DATABASE_URL) for its throwaway database
    seed_on_startup: bool = True
    seed_random_seed: int = 42
    seed_with_history: bool = True

    # Event backbone
    event_bus: str = "inmemory"  # inmemory | eventbridge | msk
    eventbridge_bus_name: str = "transittech-orchestration"
    eventbridge_sqs_queue_url: str = ""  # EventBridge rule -> SQS queue the orchestrator consumes (inbound events)
    aws_region: str = "us-east-1"
    msk_bootstrap_servers: str = ""  # comma-separated brokers
    msk_topic: str = "transittech.events"
    msk_consumer_group: str = "transit-orchestrator"
    msk_security_protocol: str = "PLAINTEXT"  # PLAINTEXT | SSL | SASL_SSL
    msk_sasl_mechanism: str = ""  # SCRAM-SHA-512 | AWS_MSK_IAM | PLAIN
    msk_username: str = ""
    msk_password: str = ""
    # Late / out-of-order events
    event_reorder_window_ms: int = 300  # events that arrive within this window are dispatched in event-time order
    event_max_age_hours: int = 24  # trigger events older than this are recorded as stale, not acted on

    # LLM
    llm_provider: str = "mock"  # mock | anthropic | bedrock
    anthropic_api_key: str = ""
    anthropic_model_fast: str = "claude-haiku-5-5"
    anthropic_model_smart: str = "claude-sonnet-5-5"
    bedrock_model_fast: str = ""
    bedrock_model_smart: str = ""
    llm_daily_token_budget: int = 200_000
    # Operator Performance SLM: which model writes the grounded answers
    slm_provider: str = "mock"  # mock | ollama | anthropic | bedrock
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2:3b"

    # Adapters
    adapter_mode: str = "mock"  # mock | http
    asset_api_base_url: str = ""
    asset_api_key: str = ""
    trip_api_base_url: str = ""
    trip_api_key: str = ""
    workforce_api_base_url: str = ""
    workforce_api_key: str = ""
    rider_comms_api_base_url: str = ""
    rider_comms_api_key: str = ""
    safety_api_base_url: str = ""
    safety_api_key: str = ""
    adapter_max_retries: int = 3
    adapter_rate_limit_per_second: float = 20.0

    # Audit
    audit_mirror: str = "jsonl"  # none | jsonl | databricks
    audit_jsonl_path: str = str(BACKEND_DIR / "data" / "audit_delta_export.jsonl")
    databricks_host: str = ""
    databricks_http_path: str = ""
    databricks_token: str = ""
    databricks_audit_table: str = "orchestration.audit.decision_log"
    audit_ship_interval_seconds: float = 2.0  # how often the audit outbox is shipped to the mirror
    audit_ship_batch_size: int = 200

    # Background simulators
    telemetry_stream_enabled: bool = False
    telemetry_interval_seconds: int = 15
    pm_scan_interval_seconds: int = 300

    # Observability
    otel_enabled: bool = False
    otel_exporter_otlp_endpoint: str = ""  # e.g. http://localhost:4318 (OTLP/HTTP); empty = console exporter
    otel_service_name: str = "transit-orchestrator"

    @property
    def is_postgres(self) -> bool:
        return self.database_url.startswith("postgresql")

    @property
    def psycopg_url(self) -> str:
        """Plain libpq URL for the LangGraph Postgres checkpointer."""
        return self.database_url.replace("postgresql+asyncpg://", "postgresql://").replace("postgresql+psycopg://", "postgresql://")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
