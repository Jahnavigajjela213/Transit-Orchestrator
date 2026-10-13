from typing import Any


def row(o: Any, exclude: tuple[str, ...] = ()) -> dict:
    return {c.name: getattr(o, c.name) for c in o.__table__.columns if c.name not in exclude}
