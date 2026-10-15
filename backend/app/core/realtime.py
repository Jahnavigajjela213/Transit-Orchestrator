"""Server-Sent Events hub. Pushes live updates to every open browser tab of a tenant."""
import asyncio
import json
import signal
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

# Open event streams never end on their own, and uvicorn waits for every open response before it stops, so a reload
# (or Ctrl+C) would hang while any browser tab is open. Chain onto the server's stop signals: once one arrives, the
# streams close and the browsers reconnect (retry: 3000) to the next worker.
shutting_down = False


def _chain_stop_signals() -> None:
    def chained(previous):
        def handler(signum, frame):
            global shutting_down
            shutting_down = True
            if callable(previous):
                previous(signum, frame)
        return handler

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, chained(signal.getsignal(sig)))
        except (ValueError, OSError):  # not the main thread (e.g. tests): nothing to chain
            pass


_chain_stop_signals()
