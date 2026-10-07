import logging

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select

from . import config
from .db import SessionLocal, init_db
from .game import GameManager
from .models import Song

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

init_db()
config.MEDIA_DIR.mkdir(parents=True, exist_ok=True)

api = FastAPI(title="Stem Guess")
api.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)
api.mount("/media", StaticFiles(directory=config.MEDIA_DIR), name="media")


@api.get("/health")
def health() -> dict:
    with SessionLocal() as db:
        songs = db.scalar(select(func.count(Song.id)))
    return {"ok": True, "songs": songs}


if (config.CLIENT_DIST_DIR / "index.html").exists():
    api.mount("/", StaticFiles(directory=config.CLIENT_DIST_DIR, html=True), name="client")
else:
    log.warning("Web client not built: run `npm run build` in client/ to serve it from this server.")


def _origin_allowed(origin: str | None, environ: dict) -> bool:
    if origin in config.CORS_ORIGINS:
        return True
    host = environ.get("HTTP_HOST")
    return bool(origin and host and origin.split("://", 1)[-1] == host)


sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=_origin_allowed)
games = GameManager(sio)


@sio.event
async def disconnect(sid, *_args):
    await games.leave(sid)


@sio.on("create_room")
async def create_room(sid, data=None):
    return await games.create_room(sid, (data or {}).get("name"))


@sio.on("join_room")
async def join_room(sid, data=None):
    data = data or {}
    return await games.join_room(sid, data.get("code"), data.get("name"))


@sio.on("leave_room")
async def leave_room(sid, _data=None):
    await games.leave(sid)
    return {"ok": True}


@sio.on("update_settings")
async def update_settings(sid, data=None):
    data = data or {}
    return await games.update_settings(sid, data.get("rounds"), data.get("maxPlayers"))


@sio.on("library")
async def library(_sid, _data=None):
    return {"ok": True, "songs": await games.library_size()}


@sio.on("start_game")
async def start_game(sid, _data=None):
    return await games.start_game(sid)


@sio.on("next_round")
async def next_round(sid, _data=None):
    return await games.next_round(sid)


@sio.on("guess")
async def guess(sid, data=None):
    return await games.guess(sid, (data or {}).get("text"))


app = socketio.ASGIApp(sio, other_asgi_app=api)
