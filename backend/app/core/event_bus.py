"""Event backbone.

InMemoryEventBus: products publish CloudEvents; each event is persisted to the
`events` table first (outbox), de-duplicated, then dispatched by a single worker so
workflow transitions never race. Unprocessed events are replayed on start.

Late and out-of-order events (vehicles with patchy connectivity): product events that
arrive within EVENT_REORDER_WINDOW_MS of each other are dispatched in event-time order,
not arrival order. Trigger events older than EVENT_MAX_AGE_HOURS, or older than the
vehicle's last return to service, are recorded as `stale` and not acted on. Duplicates
are dropped by id and by dedupe key.

EventBridgeEventBus: same local behaviour, plus forwards every product event to Amazon
EventBridge, and (with EVENTBRIDGE_SQS_QUEUE_URL) consumes events other systems publish
to the bus through an EventBridge rule -> SQS queue.

KafkaEventBus (EVENT_BUS=msk): same, over an Amazon MSK / Kafka topic: product events are
produced to the topic, and the orchestrator consumes the topic as a consumer group.
"""
import asyncio
import fnmatch
from abc import ABC, abstractmethod
import json
from datetime import timedelta
from typing import Awaitable, Callable, Optional

from sqlalchemy import select

from app.core.clock import now, precise_now
from app.core.config import settings
from app.core.database import session_scope
from app.core.events import CloudEvent
from app.core.logging import get_logger
from app.core.realtime import hub

log = get_logger("event_bus")
Handler = Callable[[CloudEvent], Awaitable[None]]
DEDUPE_WINDOW = timedelta(hours=24)
TRIGGER_TYPES = ("vehicle.fault.detected", "vehicle.pm.overdue", "trip.no_show", "trip.cancelled")
LATE_AFTER = timedelta(minutes=5)


class PublishResult:
    def __init__(self, event_id: str, status: str):
        self.event_id = event_id
        self.status = status  # queued | duplicate

    def __repr__(self) -> str:
        return f"PublishResult({self.event_id}, {self.status})"


class EventBus(ABC):
    @abstractmethod
    async def publish(self, event: CloudEvent) -> PublishResult: ...

    @abstractmethod
    def subscribe(self, pattern: str, handler: Handler) -> None: ...

    @abstractmethod
    async def start(self) -> None: ...

    @abstractmethod
    async def stop(self) -> None: ...

    @abstractmethod
    async def wait_processed(self, event_id: str, timeout: float = 15.0) -> Optional[str]: ...

    @abstractmethod
    async def drain(self) -> None: ...


class InMemoryEventBus(EventBus):
    def __init__(self) -> None:
        self._handlers: list[tuple[str, Handler]] = []
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._worker: Optional[asyncio.Task] = None
        self._waiters: dict[str, asyncio.Future] = {}
        self._done: dict[str, str] = {}

    def subscribe(self, pattern: str, handler: Handler) -> None:
        self._handlers.append((pattern, handler))

    async def publish(self, event: CloudEvent) -> PublishResult:
        from app.models import EventRecord

        if event.time.tzinfo is not None:  # store naive local time, like the rest of the system
            event.time = event.time.astimezone().replace(tzinfo=None)

        async with session_scope() as s:
            if await s.get(EventRecord, event.id):
                return PublishResult(event.id, "duplicate")
            status = "received"
            if event.dedupekey:
                dup = (
                    await s.execute(
                        select(EventRecord.id).where(
                            EventRecord.tenant_id == event.tenantid,
                            EventRecord.dedupe_key == event.dedupekey,
                            EventRecord.status != "duplicate",
                            EventRecord.received_at >= now() - DEDUPE_WINDOW,
                        ).limit(1)
                    )
                ).scalar_one_or_none()
                if dup:
                    status = "duplicate"
            s.add(
                EventRecord(
                    id=event.id, tenant_id=event.tenantid, type=event.type, source=event.source,
                    subject=event.subject, time=event.time, data=event.data, dedupe_key=event.dedupekey,
                    status=status, correlation_id=event.correlationid, trace_id=event.traceid, received_at=precise_now(),
                    processed_at=now() if status == "duplicate" else None,
                    error="Duplicate of an event already received in the last 24h" if status == "duplicate" else None,
                )
            )
        hub.publish(event.tenantid, "event", {"id": event.id, "type": event.type, "status": status, "subject": event.subject, "data": event.data})
        if status == "duplicate":
            log.info("duplicate event dropped: %s %s", event.type, event.dedupekey)
            self._done[event.id] = "duplicate"
            return PublishResult(event.id, "duplicate")
        await self._forward(event)
        await self._queue.put(event.id)
        return PublishResult(event.id, "queued")

    async def _forward(self, event: CloudEvent) -> None:
        """Hook for subclasses that also push to an external bus."""

    async def start(self) -> None:
        if self._worker:
            return
        await self._replay_pending()
        self._worker = asyncio.create_task(self._run(), name="event-bus-worker")

    async def stop(self) -> None:
        if self._worker:
            self._worker.cancel()
            try:
                await self._worker
            except (asyncio.CancelledError, Exception):
                pass
            self._worker = None

    async def _replay_pending(self) -> None:
        from app.models import EventRecord

        async with session_scope() as s:
            ids = (
                await s.execute(
                    select(EventRecord.id).where(EventRecord.status == "received").order_by(EventRecord.received_at)
                )
            ).scalars().all()
        for eid in ids:
            await self._queue.put(eid)
        if ids:
            log.info("replaying %d unprocessed events", len(ids))

    async def _run(self) -> None:
        while True:
            batch = [await self._queue.get()]
            try:
                if settings.event_reorder_window_ms > 0 and await self._is_product_event(batch[0]):
                    await asyncio.sleep(settings.event_reorder_window_ms / 1000)
                while True:
                    try:
                        batch.append(self._queue.get_nowait())
                    except asyncio.QueueEmpty:
                        break
                for event_id in await self._in_event_time_order(batch):
                    try:
                        await self._dispatch(event_id)
                    except Exception:  # never let the worker die
                        log.exception("event dispatch crashed for %s", event_id)
            finally:
                for _ in batch:
                    self._queue.task_done()

    @staticmethod
    async def _is_product_event(event_id: str) -> bool:
        from app.models import EventRecord

        async with session_scope() as s:
            rec = await s.get(EventRecord, event_id)
            return bool(rec) and rec.source != "orchestrator"

    @staticmethod
    async def _in_event_time_order(ids: list[str]) -> list[str]:
        """Orchestrator commands keep arrival order; product events are sorted by when they happened."""
        if len(ids) < 2:
            return ids
        from app.models import EventRecord

        async with session_scope() as s:
            recs = {r.id: r for r in (await s.execute(select(EventRecord).where(EventRecord.id.in_(ids)))).scalars()}
        return sorted(ids, key=lambda i: (recs[i].time, recs[i].received_at) if i in recs else (now(), now()))

    @staticmethod
    async def _staleness(event: CloudEvent) -> Optional[str]:
        if event.type not in TRIGGER_TYPES:
            return None
        age = now() - event.time
        if age > timedelta(hours=settings.event_max_age_hours):
            return f"Happened {age.total_seconds() / 3600:.1f} h ago, older than the {settings.event_max_age_hours} h limit; recorded, not acted on."
        if event.type in ("vehicle.fault.detected", "vehicle.pm.overdue") and event.subject:
            # The same problem was repaired after this signal was raised: e.g. a buffered DTC that arrives after
            # the shop fixed that very fault. A different fault arriving late is still acted on.
            from app.models import Workflow

            code = event.data.get("fault_code") if event.type == "vehicle.fault.detected" else "PM-DUE"
            async with session_scope() as s:
                done = (await s.execute(select(Workflow).where(
                    Workflow.tenant_id == event.tenantid, Workflow.vehicle_id == event.subject, Workflow.returned_at.is_not(None),
                    Workflow.returned_at > event.time))).scalars().all()
            for wf in done:
                fixed = (((wf.context or {}).get("assessment") or {}).get("fault") or {}).get("code")
                if fixed == code:
                    return (f"Happened before {code} on this vehicle was repaired and it returned to service ({wf.returned_at:%d %b %H:%M}); "
                            "already handled, not acted on.")
        return None

    async def _dispatch(self, event_id: str) -> None:
        from app.models import EventRecord

        async with session_scope() as s:
            rec = await s.get(EventRecord, event_id)
            if not rec or rec.status != "received":
                return
            event = CloudEvent(
                id=rec.id, type=rec.type, source=rec.source, subject=rec.subject, time=rec.time,
                tenantid=rec.tenant_id, data=rec.data or {}, dedupekey=rec.dedupe_key,
                correlationid=rec.correlation_id, traceid=rec.trace_id,
            )
        handlers = [h for p, h in self._handlers if fnmatch.fnmatch(event.type, p)]
        status, error = ("processed", None) if handlers else ("ignored", None)
        stale = await self._staleness(event)
        if stale:
            handlers, status, error = [], "stale", stale
            log.info("stale event not acted on: %s %s (%s)", event.type, event.id, stale)
        late_by = rec.received_at - event.time if rec.received_at and event.time else None
        for h in handlers:
            try:
                await h(event)
            except Exception as exc:  # record and continue
                log.exception("handler failed for %s", event.type)
                status, error = "failed", f"{type(exc).__name__}: {exc}"
        async with session_scope() as s:
            rec = await s.get(EventRecord, event_id)
            rec.status = status
            rec.error = error
            rec.processed_at = now()
            if late_by and late_by > LATE_AFTER and status != "stale":
                rec.note = f"Arrived {int(late_by.total_seconds() // 60)} min after it happened; handled in event-time order."
        self._done[event_id] = status
        if len(self._done) > 5000:
            self._done.clear()
        fut = self._waiters.pop(event_id, None)
        if fut and not fut.done():
            fut.set_result(status)

    async def wait_processed(self, event_id: str, timeout: float = 15.0) -> Optional[str]:
        if event_id in self._done:
            return self._done[event_id]
        fut = self._waiters.setdefault(event_id, asyncio.get_running_loop().create_future())
        try:
            return await asyncio.wait_for(asyncio.shield(fut), timeout)
        except asyncio.TimeoutError:
            return None

    async def drain(self) -> None:
        await self._queue.join()


class EventBridgeEventBus(InMemoryEventBus):
    """Outbound: every product event is put on the EventBridge bus. Inbound: an EventBridge rule targets an SQS
    queue (EVENTBRIDGE_SQS_QUEUE_URL); the orchestrator long-polls it, so events other producers put on the bus
    start and resume workflows. Our own events come back too and are dropped as duplicates by id."""

    def __init__(self) -> None:
        super().__init__()
        import boto3  # requires requirements-optional.txt

        self._client = boto3.client("events", region_name=settings.aws_region)
        self._sqs = boto3.client("sqs", region_name=settings.aws_region) if settings.eventbridge_sqs_queue_url else None
        self._poller: Optional[asyncio.Task] = None

    async def _forward(self, event: CloudEvent) -> None:
        if event.source == "orchestrator":
            return
        entry = {
            "Source": f"transittech.{event.source}",
            "DetailType": event.type,
            "Detail": event.model_dump_json(),
            "EventBusName": settings.eventbridge_bus_name,
        }
        try:
            await asyncio.to_thread(self._client.put_events, Entries=[entry])
        except Exception:
            log.exception("EventBridge forward failed (event still processed locally)")

    async def start(self) -> None:
        await super().start()
        if self._sqs and not self._poller:
            self._poller = asyncio.create_task(self._poll(), name="eventbridge-sqs-poller")

    async def stop(self) -> None:
        if self._poller:
            self._poller.cancel()
            self._poller = None
        await super().stop()

    async def _poll(self) -> None:
        url = settings.eventbridge_sqs_queue_url
        while True:
            try:
                resp = await asyncio.to_thread(self._sqs.receive_message, QueueUrl=url, MaxNumberOfMessages=10, WaitTimeSeconds=20)
            except Exception:
                log.exception("SQS receive failed; retrying in 5s")
                await asyncio.sleep(5)
                continue
            for m in resp.get("Messages", []):
                try:
                    await self.ingest_external(json.loads(m["Body"]))
                except Exception:
                    # Not deleted: SQS redelivers it, and the queue's redrive policy moves poison messages to the DLQ.
                    log.exception("could not ingest EventBridge message %s", m.get("MessageId"))
                    continue
                await asyncio.to_thread(self._sqs.delete_message, QueueUrl=url, ReceiptHandle=m["ReceiptHandle"])

    async def ingest_external(self, envelope: dict) -> PublishResult:
        """Accepts an EventBridge envelope ({"detail": <CloudEvent>}) or a bare CloudEvent."""
        detail = envelope.get("detail", envelope)
        if isinstance(detail, str):
            detail = json.loads(detail)
        return await self.publish(CloudEvent.model_validate(detail))


class KafkaEventBus(InMemoryEventBus):
    """Amazon MSK / Kafka backbone (EVENT_BUS=msk). Product events are produced to MSK_TOPIC keyed by subject so
    one vehicle's events stay in order on one partition; the orchestrator consumes the topic as a consumer group
    and commits offsets only after an event is persisted, so delivery is at-least-once and de-duplicated by id."""

    def __init__(self) -> None:
        super().__init__()
        self._producer = None
        self._consumer = None
        self._consumer_task: Optional[asyncio.Task] = None

    def _client_kwargs(self) -> dict:
        kw: dict = {"bootstrap_servers": settings.msk_bootstrap_servers, "security_protocol": settings.msk_security_protocol}
        if settings.msk_security_protocol in ("SSL", "SASL_SSL"):
            from aiokafka.helpers import create_ssl_context

            kw["ssl_context"] = create_ssl_context()
        mech = settings.msk_sasl_mechanism
        if mech == "AWS_MSK_IAM":
            from aiokafka.abc import AbstractTokenProvider
            from aws_msk_iam_sasl_signer import MSKAuthTokenProvider  # requirements-optional.txt

            class _IamToken(AbstractTokenProvider):
                async def token(self) -> str:
                    tok, _ = await asyncio.to_thread(MSKAuthTokenProvider.generate_auth_token, settings.aws_region)
                    return tok

            kw.update(security_protocol="SASL_SSL", sasl_mechanism="OAUTHBEARER", sasl_oauth_token_provider=_IamToken())
        elif mech:
            kw.update(sasl_mechanism=mech, sasl_plain_username=settings.msk_username, sasl_plain_password=settings.msk_password)
        return kw

    async def start(self) -> None:
        from aiokafka import AIOKafkaConsumer, AIOKafkaProducer  # requirements-optional.txt

        await super().start()
        if self._producer:
            return
        kw = self._client_kwargs()
        self._producer = AIOKafkaProducer(acks="all", enable_idempotence=True, **kw)
        await self._producer.start()
        self._consumer = AIOKafkaConsumer(settings.msk_topic, group_id=settings.msk_consumer_group, enable_auto_commit=False,
                                          auto_offset_reset="earliest", **kw)
        await self._consumer.start()
        self._consumer_task = asyncio.create_task(self._consume(), name="msk-consumer")

    async def stop(self) -> None:
        if self._consumer_task:
            self._consumer_task.cancel()
            self._consumer_task = None
        for c in (self._consumer, self._producer):
            if c:
                try:
                    await c.stop()
                except Exception:
                    pass
        self._consumer = self._producer = None
        await super().stop()

    async def _forward(self, event: CloudEvent) -> None:
        if event.source == "orchestrator" or not self._producer:
            return
        try:
            await self._producer.send_and_wait(settings.msk_topic, value=event.model_dump_json().encode(),
                                               key=(event.subject or event.tenantid).encode())
        except Exception:
            log.exception("MSK produce failed (event still processed locally)")

    async def _consume(self) -> None:
        while True:
            try:
                async for msg in self._consumer:
                    try:
                        await self.publish(CloudEvent.model_validate_json(msg.value))
                    except Exception:
                        log.exception("could not ingest MSK message at offset %s", msg.offset)
                    await self._consumer.commit()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("MSK consumer failed; reconnecting in 5s")
                await asyncio.sleep(5)


def build_event_bus() -> EventBus:
    if settings.event_bus == "eventbridge":
        return EventBridgeEventBus()
    if settings.event_bus == "msk":
        return KafkaEventBus()
    return InMemoryEventBus()


bus: EventBus = build_event_bus()
