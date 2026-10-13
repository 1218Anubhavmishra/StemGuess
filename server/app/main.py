import logging
import socket

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


@api.get("/lan")
def lan_address() -> dict:
    """This machine's LAN IP, so invite links opened from localhost work for other devices."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("10.255.255.255", 1))  # no packet is sent; just picks the outbound interface
            return {"ip": s.getsockname()[0]}
        except OSError:
            return {"ip": None}


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
    data = data or {}
    return await games.create_room(sid, data.get("name"), data.get("maxPlayers"))


@sio.on("join_room")
async def join_room(sid, data=None):
    data = data or {}
    return await games.join_room(sid, data.get("code"), data.get("name"))


@sio.on("rejoin")
async def rejoin(sid, data=None):
    data = data or {}
    return await games.rejoin(sid, data.get("code"), data.get("token"))


@sio.on("leave_room")
async def leave_room(sid, _data=None):
    await games.leave(sid)
    return {"ok": True}


@sio.on("update_settings")
async def update_settings(sid, data=None):
    data = data or {}
    return await games.update_settings(sid, data.get("rounds"), data.get("maxPlayers"), data.get("library"))


@sio.on("library")
async def library(_sid, _data=None):
    return {"ok": True, "libraries": await games.library_sizes()}


@sio.on("practice_round")
async def practice_round(_sid, data=None):
    data = data or {}
    return await games.practice_round(data.get("library"), data.get("exclude"))


@sio.on("set_local_tracks")
async def set_local_tracks(sid, data=None):
    return await games.set_local_tracks(sid, (data or {}).get("tracks"))


@sio.on("rtc_signal")
async def rtc_signal(sid, data=None):
    data = data or {}
    return await games.rtc_signal(sid, data.get("to"), data.get("data"))


@sio.on("relay_clip")
async def relay_clip(sid, data=None):
    return await games.relay_clip(sid, data if isinstance(data, dict) else {})


@sio.on("local_ready")
async def local_ready(sid, _data=None):
    return await games.local_ready(sid)


@sio.on("start_game")
async def start_game(sid, _data=None):
    return await games.start_game(sid)


@sio.on("guess")
async def guess(sid, data=None):
    return await games.guess(sid, (data or {}).get("option"))


app = socketio.ASGIApp(sio, other_asgi_app=api)
