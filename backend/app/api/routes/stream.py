import asyncio

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.api.deps import get_user_from_query_token
from app.core import realtime
from app.core.realtime import hub
from app.models import User

router = APIRouter(prefix="/api", tags=["live updates"])


@router.get("/stream")
async def stream(request: Request, user: User = Depends(get_user_from_query_token)):
    q = hub.subscribe(user.tenant_id)

    async def gen():
        try:
            yield "retry: 3000\nevent: hello\ndata: {}\n\n"
            idle = 0
            while not realtime.shutting_down:  # the server is stopping: end the stream so it can (the browser reconnects)
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=1)
                    idle = 0
                    yield f"data: {msg}\n\n"
                except asyncio.TimeoutError:
                    idle += 1
                    if idle >= 15:
                        idle = 0
                        yield ": keep-alive\n\n"
        finally:
            hub.unsubscribe(user.tenant_id, q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
