import asyncio
import logging
import random
import secrets
import time
from dataclasses import dataclass, field

import socketio
from sqlalchemy import select

from . import config
from .artists import artist_key, count_artists, matches
from .db import SessionLocal
from .filters import Filters, clean_filters, no_filters, song_filter
from .models import GameResult, Song, Stem

log = logging.getLogger(__name__)

MAX_NAME_LENGTH = 20
MIN_ROUNDS, MAX_ROUNDS, DEFAULT_ROUNDS = 3, 10, 3
MIN_PLAYER_LIMIT, MAX_PLAYER_LIMIT, DEFAULT_PLAYER_LIMIT = 2, 10, 2
# Clients start audio ~0.1 s after round_start arrives, so the server waits slightly longer.
AUDIO_START_GRACE = 0.3
OPTION_COUNT = 4
# A correct answer scores MAX_POINTS right at the start, falling to 1 point at the buzzer.
MAX_POINTS = 10
# From this fraction of the round on, a player may remove wrong options one at a time. A correct answer
# then scores this share of its points (index = options removed).
REMOVE_AFTER = 0.5
REMOVE_MULTIPLIERS = (1.0, 0.5, 0.2)
# Slack for the client's clock when it unlocks the button at halfway.
REMOVE_CLOCK_SLACK = 1.0

# Where a room's songs come from. Server libraries are told apart by their Song.source_file prefix;
# songs without one (e.g. processed from a personal collection) are never served to games.
SERVER_LIBRARIES = {"demo": "demo:", "cc": "cc:", "hits": "hits:"}
LIBRARIES = (*SERVER_LIBRARIES, "local")
# Host-supplied songs: the host's device cuts clips and sends them straight to the other players.
# The server only ever sees titles, never audio (apart from relaying chunks between players whose
# network blocks a direct connection; nothing is stored).
MAX_LOCAL_TRACKS = 1000
# The game draws its songs at random from a pool at least this many times its length, so the host
# can't know which of their songs will come up.
LOCAL_POOL_FACTOR = 2
LOCAL_TRANSFER_TIMEOUT = 90
MAX_RELAY_CHUNK = 256 * 1024
# Players (connected or holding a seat) plus spectators.
MAX_PEOPLE = MAX_PLAYER_LIMIT


def _is_remote(path: str) -> bool:
    return path.startswith(("http://", "https://"))


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
    score: float = 0
    guessed: bool = False  # picked the right option this round
    attempted: bool = False  # used their one pick this round
    choice: int | None = None
    round_points: float = 0
    removed: list[int] = field(default_factory=list)  # wrong options taken out for this player this round
    connected: bool = True  # False once they drop out mid-game; removed when the game ends
    # Secret handed only to this player's client so it can reclaim the seat after a reconnect.
    token: str = field(default_factory=lambda: secrets.token_urlsafe(16))


@dataclass
class Spectator:
    """Watches a game already in progress (e.g. a player who lost their seat) without playing."""

    sid: str
    name: str
    token: str = field(default_factory=lambda: secrets.token_urlsafe(16))


@dataclass
class Round:
    title: str
    artist: str
    urls: list[str]  # stem files, all played together; empty for the host's own songs
    credit: dict | None = None
    options: list[str] = field(default_factory=list)
    correct: int = 0
    duration: float = 0.0
    ends_at: float = 0.0  # time.monotonic() when the round's timer runs out


@dataclass
class Room:
    code: str
    host_sid: str
    # Seat token of the game's real host, so they get the role back after dropping out mid-game.
    host_token: str = ""
    players: dict[str, Player] = field(default_factory=dict)
    # Join as players once the game ends (if there's room).
    spectators: dict[str, Spectator] = field(default_factory=dict)
    state: str = "lobby"  # lobby | playing | finished
    total_rounds: int = DEFAULT_ROUNDS
    max_players: int = DEFAULT_PLAYER_LIMIT
    round_number: int = 0
    playlist: list[int] = field(default_factory=list)
    current: Round | None = None
    task: asyncio.Task | None = None
    all_guessed: asyncio.Event = field(default_factory=asyncio.Event)
    next_at: float | None = None  # time.monotonic() when the next round starts after a result
    # Titles the wrong options are drawn from (the game's whole library, not just its playlist).
    title_pool: list[str] = field(default_factory=list)
    # Last round_prepare / round_end payloads, replayed to players who rejoin mid-game.
    prepare_payload: dict | None = None
    end_payload: dict | None = None
    # Songs played this game ({"title", "artist", "credit", "urls", "track"?}), revealed with the final scores.
    played: list[dict] = field(default_factory=list)
    library: str = "demo"
    # Only songs by these artists, in these genres and languages play (any when empty).
    artists: list[str] = field(default_factory=list)
    genres: list[str] = field(default_factory=list)
    languages: list[str] = field(default_factory=list)
    # Songs in the library matching the filters; None until counted.
    pool_size: int | None = None
    # Host's own songs: titles only ({"title", "artist"}), indexed like the host's local clip list.
    local_tracks: list[dict] = field(default_factory=list)
    # Indices into local_tracks for this game; round N plays clip local_order[N - 1].
    local_order: list[int] = field(default_factory=list)
    local_ready: set[str] = field(default_factory=set)
    transfer_done: asyncio.Event = field(default_factory=asyncio.Event)

    def filters(self) -> Filters:
        return {"artists": self.artists, "genres": self.genres, "languages": self.languages}

    def set_filters(self, filters: Filters) -> None:
        for kind, chosen in filters.items():
            setattr(self, kind, chosen)

    def public(self) -> dict:
        return {
            "code": self.code,
            "hostId": self.host_sid,
            "state": self.state,
            "round": self.round_number,
            "totalRounds": self.total_rounds,
            "maxPlayers": self.max_players,
            "library": self.library,
            **self.filters(),
            "poolSize": self.pool_size,
            # A count only: titles would give the answers away.
            "localTracks": len(self.local_tracks),
            "players": [
                {
                    "id": p.sid,
                    "name": p.name,
                    "score": p.score,
                    "guessed": p.guessed,
                    "attempted": p.attempted,
                    "connected": p.connected,
                }
                for p in self.players.values()
            ],
            "spectators": [{"id": s.sid, "name": s.name} for s in self.spectators.values()],
        }

    def name_taken(self, name: str, sid: str) -> bool:
        # Players who dropped out mid-game don't hold on to their name.
        taken = [p.name for p in self.players.values() if p.connected and p.sid != sid]
        taken += [s.name for s in self.spectators.values() if s.sid != sid]
        return any(n.casefold() == name.casefold() for n in taken)

    def active(self) -> list[Player]:
        return [p for p in self.players.values() if p.connected]

    def drop_disconnected(self) -> None:
        self.players = {sid: p for sid, p in self.players.items() if p.connected}
        if self.host_sid in self.players:
            # If the real host never came back, their stand-in keeps the role.
            self.host_token = self.players[self.host_sid].token


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

    async def create_room(self, sid: str, name: object, max_players: object = None) -> dict:
        name = _clean_name(name)
        if not name:
            return _error("Enter a name")
        try:
            max_players = int(max_players) if max_players is not None else DEFAULT_PLAYER_LIMIT
        except (TypeError, ValueError):
            return _error("Invalid max players")
        if not MIN_PLAYER_LIMIT <= max_players <= MAX_PLAYER_LIMIT:
            return _error(f"Max players must be {MIN_PLAYER_LIMIT}-{MAX_PLAYER_LIMIT}")
        await self.leave(sid)
        room = Room(code=self._new_code(), host_sid=sid, max_players=max_players)
        self.rooms[room.code] = room
        await self._count_pool(room)
        result = await self._add_player(room, sid, name)
        room.host_token = room.players[sid].token
        return result

    async def join_room(self, sid: str, code: object, name: object, spectate: object = False) -> dict:
        name = _clean_name(name)
        if not name:
            return _error("Enter a name")
        room = self.rooms.get(str(code or "").strip().upper())
        if not room:
            return _error("Room not found")
        if room.name_taken(name, sid):
            return _error("That name is taken in this room")
        if room.state == "playing":
            if spectate is True:
                return await self._add_spectator(room, sid, name)
            if len(room.players) + len(room.spectators) >= MAX_PEOPLE:
                return _error(f"This game has already started and is full ({MAX_PEOPLE} people max)")
            return {**_error("This game has already started. You can watch it as a spectator."), "canSpectate": True}
        if len(room.players) >= room.max_players or len(room.players) + len(room.spectators) >= MAX_PEOPLE:
            return _error(f"Room is full (max {room.max_players} players)")
        await self.leave(sid)
        result = await self._add_player(room, sid, name)
        if room.state == "lobby" and len(room.players) >= room.max_players:
            await self.start_game(room.host_sid)
        return result

    async def _add_player(self, room: Room, sid: str, name: str) -> dict:
        player = Player(sid=sid, name=name)
        room.players[sid] = player
        self.sid_room[sid] = room.code
        await self.sio.enter_room(sid, room.code)
        await self._broadcast_state(room)
        return {"ok": True, "code": room.code, "playerId": sid, "token": player.token}

    async def _add_spectator(self, room: Room, sid: str, name: str) -> dict:
        if len(room.players) + len(room.spectators) >= MAX_PEOPLE:
            return _error(f"This game is full ({MAX_PEOPLE} people max, players and spectators together)")
        await self.leave(sid)
        spectator = Spectator(sid=sid, name=name)
        room.spectators[sid] = spectator
        self.sid_room[sid] = room.code
        await self.sio.enter_room(sid, room.code)
        await self._broadcast_state(room)
        await self._send_round_snapshot(room, sid)
        return {"ok": True, "code": room.code, "playerId": sid, "token": spectator.token, "spectator": True}

    async def _rejoin_spectator(self, room: Room, sid: str, spectator: Spectator) -> dict:
        if spectator.sid != sid:
            self.sid_room.pop(spectator.sid, None)
            await self.sio.leave_room(spectator.sid, room.code)
            await self.leave(sid)
            room.spectators.pop(spectator.sid, None)
            spectator.sid = sid
            room.spectators[sid] = spectator
        self.sid_room[sid] = room.code
        await self.sio.enter_room(sid, room.code)
        await self._broadcast_state(room)
        await self._send_round_snapshot(room, sid)
        return {"ok": True, "code": room.code, "playerId": sid, "token": spectator.token, "spectator": True}

    async def rejoin(self, sid: str, code: object, token: object) -> dict:
        room = self.rooms.get(str(code or "").strip().upper())
        spectator = next((s for s in room.spectators.values() if s.token == token), None) if room and token else None
        if room and spectator:
            return await self._rejoin_spectator(room, sid, spectator)
        player = next((p for p in room.players.values() if p.token == token), None) if room and token else None
        if not room or not player:
            return _error("That game is no longer available")
        if player.sid != sid:
            old_sid = player.sid
            self.sid_room.pop(old_sid, None)
            await self.sio.leave_room(old_sid, room.code)
            await self.leave(sid)
            room.players = {(sid if k == old_sid else k): p for k, p in room.players.items()}
            if room.host_sid == old_sid:
                room.host_sid = sid
            player.sid = sid
        if player.token == room.host_token:
            # The game's host dropped out mid-game and someone stood in: hand the role back.
            room.host_sid = sid
        player.connected = True
        self.sid_room[sid] = room.code
        await self.sio.enter_room(sid, room.code)
        await self._broadcast_state(room)
        await self._send_round_snapshot(room, sid)
        return {"ok": True, "code": room.code, "playerId": sid, "token": player.token}

    async def _send_round_snapshot(self, room: Room, sid: str) -> None:
        if room.state != "playing":
            return
        if room.library == "local" and room.local_order:
            # A reloaded page has lost its clips: ask the host's device to send them again.
            await self.sio.emit("local_order", {"order": room.local_order, "host": room.host_sid}, to=sid)
            if sid != room.host_sid:
                room.local_ready.discard(sid)
                await self.sio.emit("local_send", {"to": [sid]}, to=room.host_sid)
        if not room.prepare_payload:
            return
        await self.sio.emit("round_prepare", {**room.prepare_payload, "resume": True}, to=sid)
        rnd = room.current
        now = time.monotonic()
        if rnd:
            player = room.players.get(sid)
            payload = {"duration": max(0.0, rnd.ends_at - now), "options": rnd.options,
                       "removeIn": max(0.0, self._remove_unlocks_at(rnd) - now),
                       "choice": player.choice if player else None,
                       "removed": player.removed if player else []}
            await self.sio.emit("round_start", payload, to=sid)
        elif room.next_at and room.end_payload:
            await self.sio.emit("round_end", {**room.end_payload, "nextIn": max(0.0, room.next_at - now)}, to=sid)

    async def leave(self, sid: str) -> None:
        code = self.sid_room.pop(sid, None)
        room = self.rooms.get(code) if code else None
        if not room:
            return
        if room.spectators.pop(sid, None):
            await self.sio.leave_room(sid, room.code)
            room.local_ready.discard(sid)
            await self._broadcast_state(room)
            return
        player = room.players.get(sid)
        if room.state == "playing" and player:
            player.connected = False
        else:
            room.players.pop(sid, None)
        await self.sio.leave_room(sid, room.code)
        if not room.active():
            if room.task:
                room.task.cancel()
            for spectator in room.spectators.values():
                self.sid_room.pop(spectator.sid, None)
            await self.sio.emit("room_closed", {}, room=room.code)
            del self.rooms[room.code]
            return
        if room.host_sid == sid:
            room.host_sid = room.active()[0].sid
            if room.state != "playing":
                # The old host left for good (not a mid-game drop they can rejoin from).
                room.host_token = room.players[room.host_sid].token
                # The songs were on the old host's device.
                room.local_tracks = []
                if room.library == "local":
                    room.library = "demo"
                    room.set_filters(no_filters())
                await self._count_pool(room)
        room.local_ready.discard(sid)
        self._check_transfer(room)
        self._check_all_guessed(room)
        await self._broadcast_state(room)

    async def update_settings(
        self, sid: str, rounds: object, max_players: object, library: object = None, filters: dict | None = None
    ) -> dict:
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
        if library is not None and library not in LIBRARIES:
            return _error("Unknown song library")
        chosen = clean_filters(filters or {})
        if chosen is None:
            return _error("Invalid filters")
        room.total_rounds = rounds
        room.max_players = max_players
        if library is not None and library != room.library:
            room.library = library
            # Another library has other artists, genres and languages.
            room.set_filters(no_filters())
        room.set_filters(chosen)
        if library is not None or chosen:
            await self._count_pool(room)
        await self._broadcast_state(room)
        return {"ok": True}

    async def _count_pool(self, room: Room) -> None:
        if room.library == "local":
            chosen = {artist_key(a) for a in room.artists}
            room.pool_size = sum(matches(t["artist"], chosen) for t in room.local_tracks)
        else:
            room.pool_size = len(await asyncio.to_thread(self._playable_song_ids, room.library, room.filters()))

    async def set_local_tracks(self, sid: str, tracks: object) -> dict:
        room = self._room_of(sid)
        if not room:
            return _error("You are not in a room")
        if room.host_sid != sid:
            return _error("Only the host can choose songs")
        if room.state == "playing":
            return _error("Can't change songs during a game")
        if not isinstance(tracks, list) or len(tracks) > MAX_LOCAL_TRACKS:
            return _error(f"Pick up to {MAX_LOCAL_TRACKS} songs")
        cleaned = []
        for track in tracks:
            track = track if isinstance(track, dict) else {}
            title = " ".join(str(track.get("title") or "").split())[:150]
            if not title:
                return _error("Every song needs a title")
            cleaned.append({"title": title, "artist": " ".join(str(track.get("artist") or "").split())[:150]})
        room.local_tracks = cleaned
        await self._count_pool(room)
        await self._broadcast_state(room)
        return {"ok": True}

    @staticmethod
    def _with_options(rnd: Round, pool: list[str]) -> Round:
        """Fills in the multiple-choice options: the right title plus up to three others from the library."""
        seen = {rnd.title.casefold()}
        others = []
        for title in pool:
            if title.casefold() not in seen:
                seen.add(title.casefold())
                others.append(title)
        options = [rnd.title, *random.sample(others, min(OPTION_COUNT - 1, len(others)))]
        random.shuffle(options)
        rnd.options = options
        rnd.correct = options.index(rnd.title)
        return rnd

    # ----- clip transfer between players (host's own songs) -----

    def _same_room(self, sid: str, other: object) -> Room | None:
        room = self._room_of(sid)
        if room and isinstance(other, str) and (other in room.players or other in room.spectators):
            return room
        return None

    async def rtc_signal(self, sid: str, to: object, data: object) -> dict:
        """Relays WebRTC connection setup messages so two players can connect directly."""
        if not self._same_room(sid, to):
            return _error("Player not found")
        await self.sio.emit("rtc_signal", {"from": sid, "data": data}, to=to)
        return {"ok": True}

    async def relay_clip(self, sid: str, data: dict) -> dict:
        """Fallback when a direct connection fails: forwards one chunk, keeping nothing."""
        to, chunk = data.get("to"), data.get("chunk")
        room = self._same_room(sid, to)
        if not room or room.host_sid != sid or room.library != "local":
            return _error("Not allowed")
        if not isinstance(chunk, (bytes, bytearray)) or len(chunk) > MAX_RELAY_CHUNK:
            return _error("Bad chunk")
        meta = {k: data.get(k) for k in ("pos", "seq", "total", "size")}
        await self.sio.emit("clip_chunk", {**meta, "chunk": chunk}, to=to)
        return {"ok": True}

    async def local_ready(self, sid: str) -> dict:
        room = self._room_of(sid)
        if not room or room.library != "local":
            return _error("Nothing to load")
        room.local_ready.add(sid)
        self._check_transfer(room)
        await self._emit_transfer_status(room)
        return {"ok": True}

    def _waiting_for(self, room: Room) -> list[Player]:
        return [p for p in room.active() if p.sid != room.host_sid and p.sid not in room.local_ready]

    def _check_transfer(self, room: Room) -> None:
        if room.library == "local" and not self._waiting_for(room):
            room.transfer_done.set()

    async def _emit_transfer_status(self, room: Room) -> None:
        receivers = [p for p in room.active() if p.sid != room.host_sid]
        ready = sum(p.sid in room.local_ready for p in receivers)
        await self.sio.emit("local_status", {"ready": ready, "total": len(receivers)}, room=room.code)

    async def _transfer_local_clips(self, room: Room) -> None:
        room.local_ready.clear()
        room.transfer_done.clear()
        # Switch everyone to the game screen so they see the transfer progress.
        await self._broadcast_state(room)
        await self.sio.emit("local_order", {"order": room.local_order, "host": room.host_sid}, room=room.code)
        receivers = [p.sid for p in room.active() if p.sid != room.host_sid]
        if receivers:
            await self.sio.emit("local_send", {"to": receivers}, to=room.host_sid)
        self._check_transfer(room)
        await self._emit_transfer_status(room)
        # Players whose clips haven't arrived in time still play; they just may not hear the song.
        await _wait_event(room.transfer_done, LOCAL_TRANSFER_TIMEOUT)

    # ----- game flow -----

    async def library_sizes(self) -> dict[str, int]:
        return await asyncio.to_thread(self._library_sizes)

    @staticmethod
    def _library_sizes() -> dict[str, int]:
        return {name: len(GameManager._playable_song_ids(name)) for name in SERVER_LIBRARIES}

    async def library_songs(self, library: object) -> dict:
        """Every song in a server library, for the Song Library list."""
        if library not in SERVER_LIBRARIES:
            return _error("Unknown song library")
        return {"ok": True, "songs": await asyncio.to_thread(self._library_songs, library)}

    @staticmethod
    def _library_songs(library: str) -> list[dict]:
        ids = GameManager._playable_song_ids(library)
        with SessionLocal() as db:
            songs = db.scalars(select(Song).where(Song.id.in_(ids))).all()
            # Sorted here, not in SQL: Postgres and SQLite collate text differently.
            songs.sort(key=lambda s: (s.artist.casefold(), s.title.casefold()))
            return [{"id": s.id, "title": s.title, "artist": s.artist, "credit": s.credit,
                     "genre": s.genre or "", "language": s.language or ""} for s in songs]

    async def library_artists(self, library: object) -> dict:
        """Every artist in a server library with their song count, for choosing artists."""
        if library not in SERVER_LIBRARIES:
            return _error("Unknown song library")
        return {"ok": True, "artists": await asyncio.to_thread(self._library_artists, library)}

    @staticmethod
    def _library_artists(library: str) -> list[dict]:
        ids = GameManager._playable_song_ids(library)
        with SessionLocal() as db:
            return count_artists(list(db.scalars(select(Song.artist).where(Song.id.in_(ids)))))

    async def library_facets(self, library: object) -> dict:
        """Song counts per (artist, genre, language) in a server library, for its filters. No titles."""
        if library not in SERVER_LIBRARIES:
            return _error("Unknown song library")
        return {"ok": True, "facets": await asyncio.to_thread(self._library_facets, library)}

    @staticmethod
    def _library_facets(library: str) -> list[dict]:
        ids = GameManager._playable_song_ids(library)
        counts: dict[tuple[str, str, str], int] = {}
        with SessionLocal() as db:
            for row in db.execute(select(Song.artist, Song.genre, Song.language).where(Song.id.in_(ids))):
                key = (row.artist, row.genre or "", row.language or "")
                counts[key] = counts.get(key, 0) + 1
        return [{"artist": a, "genre": g, "language": lang, "songs": n} for (a, g, lang), n in counts.items()]

    async def song_clip(self, song_id: object) -> dict:
        """The stems of one library song, for playing it from the Song Library list."""
        if not isinstance(song_id, int) or isinstance(song_id, bool):
            return _error("Unknown song")
        rnd = await asyncio.to_thread(self._load_library_round, song_id)
        return {"ok": True, "urls": rnd.urls} if rnd else _error("Unknown song")

    @staticmethod
    def _load_library_round(song_id: int) -> Round | None:
        with SessionLocal() as db:
            song = db.get(Song, song_id)
            if not song or not song.source_file.startswith(tuple(SERVER_LIBRARIES.values())):
                return None
        return GameManager._load_round(song_id)

    async def practice_round(self, library: object, exclude: object = None, filters: dict | None = None) -> dict:
        """One solo round for Practice. The answer is included: nothing is at stake."""
        if library not in SERVER_LIBRARIES:
            return _error("Unknown song library")
        chosen = clean_filters(filters or {})
        if chosen is None:
            return _error("Invalid filters")
        exclude = exclude if isinstance(exclude, list) else []
        return await asyncio.to_thread(self._practice_round, library, exclude, chosen)

    @staticmethod
    def _practice_round(library: str, exclude: list, filters: Filters) -> dict:
        song_ids = GameManager._playable_song_ids(library, filters)
        if not song_ids:
            return _error("No songs match these filters" if any(filters.values()) else "This library has no songs yet")
        fresh = [i for i in song_ids if i not in set(exclude)] or song_ids
        song_id = random.choice(fresh)
        rnd = GameManager._load_round(song_id)
        if not rnd:
            return _error("Could not load a song")
        rnd = GameManager._with_options(rnd, GameManager._option_titles(library, song_ids))
        return {
            "ok": True,
            "round": {
                "id": song_id,
                "urls": rnd.urls,
                "options": rnd.options,
                "correct": rnd.correct,
                "title": rnd.title,
                "artist": rnd.artist,
                "credit": rnd.credit,
            },
        }

    async def start_game(self, sid: str) -> dict:
        room = self._room_of(sid)
        if not room:
            return _error("You are not in a room")
        if room.host_sid != sid:
            return _error("Only the host can start the game")
        if room.state == "playing":
            return _error("Game already running")

        local = room.library == "local"
        filtered = room.artists if local else any(room.filters().values())
        by_artists = (" by the chosen artists" if local else " matching the filters") if filtered else ""
        if local:
            chosen = {artist_key(a) for a in room.artists}
            song_ids = [i for i, t in enumerate(room.local_tracks) if matches(t["artist"], chosen)]
            needed = room.total_rounds * LOCAL_POOL_FACTOR
            if len(song_ids) < needed:
                return _error(
                    f"Add at least {needed} songs{by_artists} for a {room.total_rounds}-song game "
                    f"({len(song_ids)} so far), so the game can pick them at random."
                )
            titles = [room.local_tracks[i]["title"] for i in song_ids]
            room.title_pool = titles if len(set(titles)) >= OPTION_COUNT else [t["title"] for t in room.local_tracks]
        else:
            song_ids = await asyncio.to_thread(self._playable_song_ids, room.library, room.filters())
            if len(song_ids) < MIN_ROUNDS:
                return _error(f"Games need at least {MIN_ROUNDS} songs{by_artists or ' in the library'} "
                              f"(there are {len(song_ids)}).")
            room.title_pool = await asyncio.to_thread(self._option_titles, room.library, song_ids)
        if len(song_ids) < room.total_rounds:
            return _error(f"Only {len(song_ids)} songs available. Pick {len(song_ids)} or fewer.")

        random.shuffle(song_ids)
        room.playlist = song_ids[: room.total_rounds]
        room.local_order = room.playlist if room.library == "local" else []
        room.round_number = 0
        room.played = []
        for p in room.players.values():
            p.score = 0
            p.guessed = p.attempted = False
            p.choice = None
            p.removed = []
        room.state = "playing"
        room.task = asyncio.create_task(self._run_game(room))
        return {"ok": True}

    @staticmethod
    def _playable_song_ids(library: str, filters: Filters | None = None) -> list[int]:
        prefix = SERVER_LIBRARIES[library]
        keep = song_filter(filters)
        with SessionLocal() as db:
            query = (select(Song.id, Song.artist, Song.genre, Song.language).join(Stem)
                     .where(Song.source_file.startswith(prefix)).distinct())
            return [r.id for r in db.execute(query) if keep(r.artist, r.genre, r.language)]

    @staticmethod
    def _titles(song_ids: list[int]) -> list[str]:
        with SessionLocal() as db:
            return list(db.scalars(select(Song.title).where(Song.id.in_(song_ids))))

    @staticmethod
    def _option_titles(library: str, song_ids: list[int]) -> list[str]:
        """Wrong options come from the songs matching the filters, or the whole library if they have too few."""
        titles = GameManager._titles(song_ids)
        if len({t.casefold() for t in titles}) >= OPTION_COUNT:
            return titles
        return GameManager._titles(GameManager._playable_song_ids(library))

    @staticmethod
    def _load_round(song_id: int) -> Round | None:
        with SessionLocal() as db:
            song = db.get(Song, song_id)
            if not song or not song.stems:
                return None
            return Round(
                title=song.title,
                artist=song.artist,
                # Local paths are relative to the server; clients resolve against their server URL.
                urls=[s.path if _is_remote(s.path) else f"/media/{s.path}" for s in song.stems],
                credit=song.credit,
            )

    async def _run_game(self, room: Room) -> None:
        try:
            local = room.library == "local"
            if local:
                await self._transfer_local_clips(room)
            for position, song_id in enumerate(room.playlist):
                if not room.active():
                    return
                if local:
                    track = room.local_tracks[song_id]
                    rnd = Round(title=track["title"], artist=track["artist"], urls=[])
                    await self._play_round(room, self._with_options(rnd, room.title_pool), track=position)
                    continue
                rnd = await asyncio.to_thread(self._load_round, song_id)
                if rnd:
                    await self._play_round(room, self._with_options(rnd, room.title_pool))
            await self._finish(room)
        except asyncio.CancelledError:
            pass
        except Exception:
            log.exception("Game loop crashed in room %s", room.code)
            room.state = "lobby"
            room.current = None
            room.drop_disconnected()
            await self._broadcast_state(room)

    async def _play_round(self, room: Room, rnd: Round, track: int | None = None) -> None:
        room.round_number += 1
        room.all_guessed.clear()
        for p in room.players.values():
            p.guessed = p.attempted = False
            p.choice = None
            p.round_points = 0
            p.removed = []
        await self._broadcast_state(room)

        room.end_payload = None
        room.prepare_payload = {"round": room.round_number, "totalRounds": room.total_rounds, "urls": rnd.urls}
        if track is not None:
            # Position in local_order of the clip each player already holds.
            room.prepare_payload["track"] = track
        await self.sio.emit("round_prepare", room.prepare_payload, room=room.code)
        await asyncio.sleep(config.PREPARE_SECONDS)

        room.current = rnd
        rnd.duration = config.ROUND_SECONDS
        rnd.ends_at = time.monotonic() + rnd.duration
        # Clients loop the clip until the countdown runs out, so the round length doesn't depend on it.
        await self.sio.emit("round_start", {"duration": rnd.duration, "options": rnd.options,
                                            "removeIn": rnd.duration * REMOVE_AFTER}, room=room.code)
        await _wait_event(room.all_guessed, rnd.duration + AUDIO_START_GRACE)

        room.current = None
        winners = [p for p in room.players.values() if p.guessed]
        room.end_payload = {
            "title": rnd.title,
            "artist": rnd.artist,
            "credit": rnd.credit,
            "options": rnd.options,
            "correct": rnd.correct,
            "isLast": room.round_number >= room.total_rounds,
            "winners": [p.name for p in winners],
            "points": {p.name: p.round_points for p in winners},
        }
        room.played.append({"title": rnd.title, "artist": rnd.artist, "credit": rnd.credit, "urls": rnd.urls,
                            **({"track": track} if track is not None else {})})
        room.next_at = time.monotonic() + config.RESULT_SECONDS
        await self.sio.emit("round_end", {**room.end_payload, "nextIn": config.RESULT_SECONDS}, room=room.code)
        await asyncio.sleep(config.RESULT_SECONDS)
        room.next_at = None

    async def _finish(self, room: Room) -> None:
        room.state = "finished"
        ranking = sorted(room.players.values(), key=lambda p: p.score, reverse=True)
        try:
            await asyncio.to_thread(self._save_results, room.code, ranking)
        except Exception:
            log.exception("Failed to save results for room %s", room.code)
        await self.sio.emit(
            "game_over",
            {
                "ranking": [
                    {"id": p.sid, "name": p.name, "score": p.score, "guessed": False, "attempted": False, "connected": p.connected}
                    for p in ranking
                ],
                "songs": room.played,
            },
            room=room.code,
        )
        room.drop_disconnected()
        for spectator in list(room.spectators.values()):
            if len(room.players) >= room.max_players:
                break
            del room.spectators[spectator.sid]
            # Same seat token, so their saved session now rejoins them as a player.
            room.players[spectator.sid] = Player(sid=spectator.sid, name=spectator.name, token=spectator.token)
        await self._broadcast_state(room)

    @staticmethod
    def _save_results(code: str, ranking: list[Player]) -> None:
        with SessionLocal() as db:
            db.add_all(GameResult(room_code=code, player_name=p.name, score=round(p.score)) for p in ranking)
            db.commit()

    # ----- guessing -----

    async def guess(self, sid: str, option: object) -> dict:
        room = self._room_of(sid)
        rnd = room.current if room else None
        player = room.players.get(sid) if room else None
        if not room or not rnd or not player:
            return _error("No round in progress")
        if not isinstance(option, int) or isinstance(option, bool) or not 0 <= option < len(rnd.options):
            return _error("Pick one of the options")
        if player.attempted:
            return _error("You've already answered this round")
        if option in player.removed:
            return _error("That option was removed")

        player.attempted = True
        player.choice = option
        if option == rnd.correct:
            player.guessed = True
            # Faster answers score more: MAX_POINTS at the start, 1 point at the buzzer.
            left = min(1.0, max(0.0, (rnd.ends_at - time.monotonic()) / rnd.duration))
            points = (1 + round((MAX_POINTS - 1) * left)) * REMOVE_MULTIPLIERS[len(player.removed)]
            player.round_points = round(points, 1)
            player.score = round(player.score + player.round_points, 1)
            result = "correct"
        else:
            result = "wrong"

        await self._broadcast_state(room)
        self._check_all_guessed(room)
        return {"ok": True, "result": result}

    @staticmethod
    def _remove_unlocks_at(rnd: Round) -> float:
        return rnd.ends_at - rnd.duration * (1 - REMOVE_AFTER)

    async def remove_option(self, sid: str) -> dict:
        """Takes one wrong option out for this player only; their correct answer then scores less."""
        room = self._room_of(sid)
        rnd = room.current if room else None
        player = room.players.get(sid) if room else None
        if not room or not rnd or not player:
            return _error("No round in progress")
        if player.attempted:
            return _error("You've already answered this round")
        if time.monotonic() < self._remove_unlocks_at(rnd) - REMOVE_CLOCK_SLACK:
            return _error("Options can be removed from halfway through the round")
        wrong = [i for i in range(len(rnd.options)) if i != rnd.correct and i not in player.removed]
        if len(player.removed) >= len(REMOVE_MULTIPLIERS) - 1 or not wrong:
            return _error("No more options can be removed")
        player.removed.append(random.choice(wrong))
        return {"ok": True, "removed": player.removed, "multiplier": REMOVE_MULTIPLIERS[len(player.removed)]}

    def _check_all_guessed(self, room: Room) -> None:
        active = room.active()
        if room.current and active and all(p.attempted for p in active):
            room.all_guessed.set()
