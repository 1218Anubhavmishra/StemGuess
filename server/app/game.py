import asyncio
import logging
import random
import string
from dataclasses import dataclass, field

import socketio
from sqlalchemy import select

from . import config
from .db import SessionLocal
from .matching import CLOSE_THRESHOLD, CORRECT_THRESHOLD, similarity
from .media import audio_duration
from .models import GameResult, Song, Stem

log = logging.getLogger(__name__)

MAX_NAME_LENGTH = 20
MIN_ROUNDS, MAX_ROUNDS, DEFAULT_ROUNDS = 3, 10, 5
MIN_PLAYER_LIMIT, MAX_PLAYER_LIMIT, DEFAULT_PLAYER_LIMIT = 2, 10, 8
MIN_ROUND_SECONDS = 10
# Clients start audio ~0.1 s after round_start arrives, so the server waits slightly longer.
AUDIO_START_GRACE = 0.3

# Hardest-to-recognise first, vocals last.
STEM_ORDER = [
    "drums", "percussion", "bass", "guitars", "guitar", "keys", "piano",
    "strings", "wind", "other", "accompaniments", "accompaniment",
    "backing_vocals", "vocals",
]


def _stem_rank(name: str) -> int:
    name = name.lower()
    if name in STEM_ORDER:
        return STEM_ORDER.index(name)
    if "vocal" in name:
        return len(STEM_ORDER)
    return STEM_ORDER.index("other")


def _clean_name(name: object) -> str:
    return " ".join(str(name or "").split())[:MAX_NAME_LENGTH]


def _error(message: str) -> dict:
    return {"ok": False, "error": message}


async def _wait_event(event: asyncio.Event, timeout: float) -> bool:
    try:
        await asyncio.wait_for(event.wait(), timeout)
        return True
    except asyncio.TimeoutError:
        return False


@dataclass
class Player:
    sid: str
    name: str
    score: int = 0
    guessed: bool = False  # guessed correctly this round
    attempted: bool = False  # used their one guess this round


@dataclass
class Round:
    title: str
    artist: str
    answers: list[str]
    stems: list[dict]
    duration: float | None = None
    revealed: int = 0


@dataclass
class Room:
    code: str
    host_sid: str
    players: dict[str, Player] = field(default_factory=dict)
    state: str = "lobby"  # lobby | playing | finished
    total_rounds: int = DEFAULT_ROUNDS
    max_players: int = DEFAULT_PLAYER_LIMIT
    round_number: int = 0
    playlist: list[int] = field(default_factory=list)
    current: Round | None = None
    task: asyncio.Task | None = None
    all_guessed: asyncio.Event = field(default_factory=asyncio.Event)

    def public(self) -> dict:
        return {
            "code": self.code,
            "hostId": self.host_sid,
            "state": self.state,
            "round": self.round_number,
            "totalRounds": self.total_rounds,
            "maxPlayers": self.max_players,
            "players": [
                {"id": p.sid, "name": p.name, "score": p.score, "guessed": p.guessed, "attempted": p.attempted}
                for p in self.players.values()
            ],
        }


class GameManager:
    """In-memory room state. Requires a single server process."""

    def __init__(self, sio: socketio.AsyncServer):
        self.sio = sio
        self.rooms: dict[str, Room] = {}
        self.sid_room: dict[str, str] = {}

    def _room_of(self, sid: str) -> Room | None:
        code = self.sid_room.get(sid)
        return self.rooms.get(code) if code else None

    def _new_code(self) -> str:
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ"
        while True:
            code = "".join(random.choices(alphabet, k=4))
            if code not in self.rooms:
                return code

    async def _broadcast_state(self, room: Room) -> None:
        await self.sio.emit("room_state", room.public(), room=room.code)

    # ----- lobby -----

    async def create_room(self, sid: str, name: object) -> dict:
        name = _clean_name(name)
        if not name:
            return _error("Enter a name")
        await self.leave(sid)
        room = Room(code=self._new_code(), host_sid=sid)
        self.rooms[room.code] = room
        return await self._add_player(room, sid, name)

    async def join_room(self, sid: str, code: object, name: object) -> dict:
        name = _clean_name(name)
        if not name:
            return _error("Enter a name")
        room = self.rooms.get(str(code or "").strip().upper())
        if not room:
            return _error("Room not found")
        if room.state == "playing":
            return _error("Game already in progress")
        if len(room.players) >= room.max_players:
            return _error(f"Room is full (max {room.max_players} players)")
        if any(p.name.casefold() == name.casefold() for p in room.players.values() if p.sid != sid):
            return _error("That name is taken in this room")
        await self.leave(sid)
        return await self._add_player(room, sid, name)

    async def _add_player(self, room: Room, sid: str, name: str) -> dict:
        room.players[sid] = Player(sid=sid, name=name)
        self.sid_room[sid] = room.code
        await self.sio.enter_room(sid, room.code)
        await self._broadcast_state(room)
        return {"ok": True, "code": room.code, "playerId": sid}

    async def leave(self, sid: str) -> None:
        code = self.sid_room.pop(sid, None)
        room = self.rooms.get(code) if code else None
        if not room:
            return
        room.players.pop(sid, None)
        await self.sio.leave_room(sid, room.code)
        if not room.players:
            if room.task:
                room.task.cancel()
            del self.rooms[room.code]
            return
        if room.host_sid == sid:
            room.host_sid = next(iter(room.players))
        self._check_all_guessed(room)
        await self._broadcast_state(room)

    async def update_settings(self, sid: str, rounds: object, max_players: object) -> dict:
        room = self._room_of(sid)
        if not room:
            return _error("You are not in a room")
        if room.host_sid != sid:
            return _error("Only the host can change settings")
        if room.state == "playing":
            return _error("Can't change settings during a game")
        try:
            rounds = int(rounds) if rounds is not None else room.total_rounds
            max_players = int(max_players) if max_players is not None else room.max_players
        except (TypeError, ValueError):
            return _error("Invalid settings")
        if not MIN_ROUNDS <= rounds <= MAX_ROUNDS:
            return _error(f"Songs per game must be {MIN_ROUNDS}-{MAX_ROUNDS}")
        if not MIN_PLAYER_LIMIT <= max_players <= MAX_PLAYER_LIMIT:
            return _error(f"Max players must be {MIN_PLAYER_LIMIT}-{MAX_PLAYER_LIMIT}")
        if max_players < len(room.players):
            return _error(f"{len(room.players)} players are already in the room")
        room.total_rounds = rounds
        room.max_players = max_players
        await self._broadcast_state(room)
        return {"ok": True}

    # ----- game flow -----

    async def library_size(self) -> int:
        return len(await asyncio.to_thread(self._playable_song_ids))

    async def start_game(self, sid: str) -> dict:
        room = self._room_of(sid)
        if not room:
            return _error("You are not in a room")
        if room.host_sid != sid:
            return _error("Only the host can start the game")
        if room.state == "playing":
            return _error("Game already running")

        song_ids = await asyncio.to_thread(self._playable_song_ids)
        if len(song_ids) < MIN_ROUNDS:
            return _error(f"The library needs at least {MIN_ROUNDS} songs (it has {len(song_ids)}).")
        if len(song_ids) < room.total_rounds:
            return _error(f"Only {len(song_ids)} songs in the library. Pick {len(song_ids)} or fewer.")

        random.shuffle(song_ids)
        room.playlist = song_ids[: room.total_rounds]
        room.round_number = 0
        for p in room.players.values():
            p.score = 0
            p.guessed = p.attempted = False
        room.state = "playing"
        room.task = asyncio.create_task(self._run_game(room))
        return {"ok": True}

    @staticmethod
    def _playable_song_ids() -> list[int]:
        with SessionLocal() as db:
            return list(db.scalars(select(Song.id).join(Stem).distinct()))

    @staticmethod
    def _load_round(song_id: int) -> Round | None:
        with SessionLocal() as db:
            song = db.get(Song, song_id)
            if not song or not song.stems:
                return None
            if song.duration is None:
                lengths = [d for s in song.stems if (d := audio_duration(config.MEDIA_DIR / s.path))]
                if lengths:
                    song.duration = max(lengths)
                    db.commit()
            stems = sorted(song.stems, key=lambda s: _stem_rank(s.name))
            return Round(
                title=song.title,
                artist=song.artist,
                duration=song.duration,
                answers=[song.title, *(song.aliases or [])],
                # Relative to the server; clients resolve against their server URL.
                stems=[{"name": s.name, "url": f"/media/{s.path}"} for s in stems],
            )

    async def _run_game(self, room: Room) -> None:
        try:
            for song_id in room.playlist:
                if not room.players:
                    return
                rnd = await asyncio.to_thread(self._load_round, song_id)
                if rnd:
                    await self._play_round(room, rnd)
            await self._finish(room)
        except asyncio.CancelledError:
            pass
        except Exception:
            log.exception("Game loop crashed in room %s", room.code)
            room.state = "lobby"
            room.current = None
            await self._broadcast_state(room)

    async def _play_round(self, room: Room, rnd: Round) -> None:
        room.round_number += 1
        room.all_guessed.clear()
        for p in room.players.values():
            p.guessed = p.attempted = False
        await self._broadcast_state(room)

        await self.sio.emit(
            "round_prepare",
            {"round": room.round_number, "totalRounds": room.total_rounds, "stems": rnd.stems},
            room=room.code,
        )
        await asyncio.sleep(config.PREPARE_SECONDS)

        room.current = rnd
        if rnd.duration:
            # The round lasts exactly one play-through of the clip; stems are spread evenly across it.
            duration = max(rnd.duration, MIN_ROUND_SECONDS)
            interval = duration / len(rnd.stems)
        else:
            interval = config.STEM_REVEAL_SECONDS
            duration = len(rnd.stems) * interval + config.ROUND_EXTRA_SECONDS
        await self.sio.emit("round_start", {"duration": duration}, room=room.code)
        try:
            await asyncio.wait_for(self._reveal_stems(room, rnd, interval), timeout=duration + AUDIO_START_GRACE)
        except asyncio.TimeoutError:
            pass

        room.current = None
        await self.sio.emit(
            "round_end",
            {"title": rnd.title, "artist": rnd.artist, "stems": rnd.stems},
            room=room.code,
        )
        await asyncio.sleep(config.ROUND_END_PAUSE_SECONDS)

    async def _reveal_stems(self, room: Room, rnd: Round, interval: float) -> None:
        for index, stem in enumerate(rnd.stems):
            rnd.revealed = index + 1
            await self.sio.emit("stem_reveal", {"index": index, "name": stem["name"]}, room=room.code)
            if await _wait_event(room.all_guessed, interval):
                return
        await room.all_guessed.wait()

    async def _finish(self, room: Room) -> None:
        room.state = "finished"
        ranking = sorted(room.players.values(), key=lambda p: p.score, reverse=True)
        try:
            await asyncio.to_thread(self._save_results, room.code, ranking)
        except Exception:
            log.exception("Failed to save results for room %s", room.code)
        await self.sio.emit(
            "game_over",
            {"ranking": [{"id": p.sid, "name": p.name, "score": p.score, "guessed": False, "attempted": False} for p in ranking]},
            room=room.code,
        )
        await self._broadcast_state(room)

    @staticmethod
    def _save_results(code: str, ranking: list[Player]) -> None:
        with SessionLocal() as db:
            db.add_all(GameResult(room_code=code, player_name=p.name, score=p.score) for p in ranking)
            db.commit()

    # ----- guessing -----

    async def guess(self, sid: str, text: object) -> dict:
        room = self._room_of(sid)
        rnd = room.current if room else None
        player = room.players.get(sid) if room else None
        text = str(text or "").strip()[:100]
        if not room or not rnd or not player or not text:
            return _error("No round in progress")
        if player.attempted:
            return _error("You've already used your guess this round")

        player.attempted = True
        score = similarity(text, rnd.answers)
        if score >= CORRECT_THRESHOLD:
            player.guessed = True
            player.score += 1
            result = "correct"
            await self.sio.emit("feed", {"type": "correct", "name": player.name}, room=room.code)
        elif score >= CLOSE_THRESHOLD:
            # Near-misses stay private so they don't hint the answer to others.
            result = "close"
        else:
            result = "wrong"
            await self.sio.emit("feed", {"type": "guess", "name": player.name, "text": text}, room=room.code)

        await self._broadcast_state(room)
        self._check_all_guessed(room)
        return {"ok": True, "result": result}

    def _check_all_guessed(self, room: Room) -> None:
        if room.current and room.players and all(p.attempted for p in room.players.values()):
            room.all_guessed.set()
