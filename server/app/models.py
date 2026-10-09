from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Song(Base):
    __tablename__ = "songs"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(300))
    artist: Mapped[str] = mapped_column(String(300), default="")
    aliases: Mapped[list[str]] = mapped_column(JSON, default=list)
    source_file: Mapped[str] = mapped_column(String(500), unique=True)
    # Clip length in seconds; filled lazily from the stem files.
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    stems: Mapped[list["Stem"]] = relationship(
        back_populates="song", cascade="all, delete-orphan", lazy="selectin"
    )


class Stem(Base):
    __tablename__ = "stems"

    id: Mapped[int] = mapped_column(primary_key=True)
    song_id: Mapped[int] = mapped_column(ForeignKey("songs.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(50))
    # Relative to MEDIA_DIR, or an absolute URL once uploaded to object storage (R2).
    # File names never contain the song title.
    path: Mapped[str] = mapped_column(String(500))

    song: Mapped[Song] = relationship(back_populates="stems")


class GameResult(Base):
    __tablename__ = "game_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    room_code: Mapped[str] = mapped_column(String(8))
    player_name: Mapped[str] = mapped_column(String(40))
    score: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
