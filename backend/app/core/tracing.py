"""Tracing helpers (OpenTelemetry).

OTEL_ENABLED=true with opentelemetry-sdk installed (requirements-optional.txt):
- OTEL_EXPORTER_OTLP_ENDPOINT set (e.g. http://localhost:4318 for Jaeger, Grafana Tempo, AWS ADOT collector):
  spans are exported over OTLP/HTTP.
- not set: spans are printed to the console.
Every span inside a workflow is parented on the workflow's trace_id (the same id written to every audit record),
so one incident is one trace across the orchestrator, the domain agents and the product adapters. FastAPI requests
are traced too when opentelemetry-instrumentation-fastapi is installed.
Otherwise spans are no-ops, but every workflow still carries a trace_id in the audit log.
"""
import uuid
from contextlib import contextmanager
from typing import Optional

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger("tracing")
_tracer = None


def setup_tracing(app=None) -> None:
    global _tracer
    if not settings.otel_enabled:
        return
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor
    except ImportError:
        log.warning("OTEL_ENABLED=true but opentelemetry-sdk is not installed; tracing disabled")
        return
    provider = TracerProvider(resource=Resource.create({"service.name": settings.otel_service_name,
                                                       "deployment.environment": settings.environment}))
    if settings.otel_exporter_otlp_endpoint:
        try:
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

            endpoint = settings.otel_exporter_otlp_endpoint.rstrip("/")
            provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces")))
            log.info("OpenTelemetry tracing enabled (OTLP -> %s)", endpoint)
        except ImportError:
            log.warning("opentelemetry-exporter-otlp-proto-http not installed; falling back to the console exporter")
            provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
    else:
        provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
        log.info("OpenTelemetry tracing enabled (console exporter)")
    trace.set_tracer_provider(provider)
    _tracer = trace.get_tracer("transit-orchestrator")
    if app is not None:
        try:
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

            FastAPIInstrumentor.instrument_app(app, excluded_urls="api/stream,api/health")
        except ImportError:
            pass


def new_trace_id() -> str:
    return uuid.uuid4().hex


def _parent(trace_id: Optional[str]):
    """A remote parent with the workflow's trace id, so spans from many requests join one trace."""
    if not trace_id or len(trace_id) != 32:
        return None
    try:
        from opentelemetry import trace
        from opentelemetry.trace import NonRecordingSpan, SpanContext, TraceFlags

        tid = int(trace_id, 16)
        if tid == 0:
            return None
        sc = SpanContext(trace_id=tid, span_id=int(trace_id[:16], 16) or 1, is_remote=True, trace_flags=TraceFlags(TraceFlags.SAMPLED))
        return trace.set_span_in_context(NonRecordingSpan(sc))
    except Exception:
        return None


@contextmanager
def span(name: str, trace_id: Optional[str] = None, **attributes):
    if _tracer is None:
        yield None
        return
    from opentelemetry import trace

    current = trace.get_current_span()
    ctx = None if current.get_span_context().is_valid else _parent(trace_id)
    with _tracer.start_as_current_span(name, context=ctx) as s:
        if trace_id:
            s.set_attribute("workflow.trace_id", trace_id)
        for k, v in attributes.items():
            if v is not None:
                s.set_attribute(k, str(v))
        yield s
