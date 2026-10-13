"""Reset all demo data. Next start re-seeds synthetic data and retrains the models.

Usage (backend folder, server stopped):  python scripts/reset_data.py
PostgreSQL: drops and recreates the database named in DATABASE_URL. SQLite: deletes the files in data/.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402


async def reset_postgres() -> None:
    import asyncpg
    from sqlalchemy.engine import make_url

    u = make_url(settings.database_url)
    conn = await asyncpg.connect(user=u.username, password=u.password, host=u.host or "localhost", port=u.port or 5432, database="postgres")
    await conn.execute(f'DROP DATABASE IF EXISTS "{u.database}" WITH (FORCE)')
    await conn.close()
    print(f"Dropped database {u.database}. Start the backend to recreate and re-seed it.")


if __name__ == "__main__":
    if settings.is_postgres:
        if sys.platform == "win32":
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        asyncio.run(reset_postgres())
    data = Path(__file__).resolve().parents[1] / "data"
    removed = sum(1 for f in data.glob("*") if f.is_file() and not f.unlink())
    print(f"Removed {removed} local file(s) from {data}.")
