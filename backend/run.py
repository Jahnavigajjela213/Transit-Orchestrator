"""Start the backend:  python run.py   (same as uvicorn app.main:app --port 8000)

On Windows the Postgres checkpointer (psycopg async) needs the selector event loop,
which plain `uvicorn` does not set; this script does.
"""
import asyncio
import os
import sys

import uvicorn

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

if __name__ == "__main__":
    uvicorn.run("app.main:app", host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")), log_level="info")
