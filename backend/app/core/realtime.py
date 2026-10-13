"""Server-Sent Events hub. Pushes live updates to every open browser tab of a tenant."""
import asyncio
import json
from typing import Any

from app.core.clock import now


class RealtimeHub:
    def __init__(self) -> None:
        self._subs: set[tuple[str, asyncio.Queue]] = set()

    def subscribe(self, tenant_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        self._subs.add((tenant_id, q))
        return q

    def unsubscribe(self, tenant_id: str, q: asyncio.Queue) -> None:
        self._subs.discard((tenant_id, q))

    def publish(self, tenant_id: str, kind: str, payload: dict[str, Any]) -> None:
        msg = json.dumps({"kind": kind, "at": now().isoformat(), "data": payload}, default=str)
        for tid, q in list(self._subs):
            if tid == tenant_id:
                try:
                    q.put_nowait(msg)
                except asyncio.QueueFull:
                    pass

    @property
    def connections(self) -> int:
        return len(self._subs)


hub = RealtimeHub()
