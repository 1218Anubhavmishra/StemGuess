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


sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=config.CORS_ORIGINS)
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


@sio.on("start_game")
async def start_game(sid, data=None):
    return await games.start_game(sid, (data or {}).get("rounds"))


@sio.on("guess")
async def guess(sid, data=None):
    return await games.guess(sid, (data or {}).get("text"))


app = socketio.ASGIApp(sio, other_asgi_app=api)
