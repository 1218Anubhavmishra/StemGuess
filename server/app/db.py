from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import DATABASE_URL

_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=_connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


# Columns added after the first release; create_all() doesn't alter existing tables.
_ADDED_COLUMNS = {
    "songs": {"duration": "FLOAT", "credit": "JSON", "genre": "VARCHAR(100)", "language": "VARCHAR(100)"}
}
# Text columns made longer after the first release. Only Postgres enforces lengths.
_WIDENED_COLUMNS = {"songs": {"genre": 100, "language": 100}}


def init_db() -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(engine)
    inspector = inspect(engine)
    for table, columns in _ADDED_COLUMNS.items():
        existing = {c["name"] for c in inspector.get_columns(table)}
        for name, sql_type in columns.items():
            if name not in existing:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}"))
    if engine.dialect.name != "postgresql":
        return
    for table, columns in _WIDENED_COLUMNS.items():
        lengths = {c["name"]: getattr(c["type"], "length", None) for c in inspect(engine).get_columns(table)}
        for name, length in columns.items():
            if (lengths.get(name) or length) < length:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN {name} TYPE VARCHAR({length})"))
