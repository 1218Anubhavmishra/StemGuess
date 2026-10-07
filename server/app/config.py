import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _database_url() -> str:
    url = os.getenv("DATABASE_URL") or f"sqlite:///{BASE_DIR / 'stemguess.db'}"
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def _csv(name: str, default: str) -> list[str]:
    return [v.strip() for v in os.getenv(name, default).split(",") if v.strip()]


DATABASE_URL = _database_url()
MEDIA_DIR = Path(os.getenv("MEDIA_DIR") or BASE_DIR / "media")
SONGS_INPUT_DIR = Path(os.getenv("SONGS_INPUT_DIR") or BASE_DIR / "songs_input")
CLIENT_DIST_DIR = Path(os.getenv("CLIENT_DIST_DIR") or BASE_DIR.parent / "client" / "dist")
# Extra origins besides the server's own (which is always allowed).
CORS_ORIGINS = _csv("CORS_ORIGINS", "http://localhost:5173,https://localhost,capacitor-electron://-")

MUSIC_AI_API_KEY = os.getenv("MUSIC_AI_API_KEY", "")
MUSIC_AI_WORKFLOW = os.getenv("MUSIC_AI_WORKFLOW", "")
MUSIC_AI_BASE_URL = os.getenv("MUSIC_AI_BASE_URL", "https://api.music.ai/v1").rstrip("/")
CLIP_SECONDS = int(os.getenv("CLIP_SECONDS", "45"))

STEM_REVEAL_SECONDS = float(os.getenv("STEM_REVEAL_SECONDS", "8"))
ROUND_EXTRA_SECONDS = float(os.getenv("ROUND_EXTRA_SECONDS", "10"))
PREPARE_SECONDS = float(os.getenv("PREPARE_SECONDS", "3"))