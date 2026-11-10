import asyncio
import logging
import random
import secrets
import time
from dataclasses import dataclass, field

import socketio
from sqlalchemy import select

from . import config
from .artists import count_artists
from .db import SessionLocal
from .filters import Filters, clean_filters, clean_search, no_filters, search_test, song_filter
from .models import GameResult, Song, Stem

log = logging.getLogger(__name__)

MAX_NAME_LENGTH = 20
MIN_ROUNDS, MAX_ROUNDS, DEFAULT_ROUNDS = 3, 10, 10
MIN_PLAYER_LIMIT, MAX_PLAYER_LIMIT, DEFAULT_PLAYER_LIMIT = 2, 10, 2
# Clients start audio ~0.1 s after round_start arrives, so the server waits slightly longer.
AUDIO_START_GRACE = 0.3
OPTION_COUNT = 4
# Songs listed in the lobby as the game's options; its rounds secretly play total_rounds of them.
OPTION_LIST_SIZE = 20
# A correct answer scores MAX_POINTS right at the start, falling to 1 point at the buzzer.
MAX_POINTS = 10

# Where a room's songs come from. Libraries are told apart by their Song.source_file prefix; the game has
# one, previews of popular hits. Songs of any other source (or hidden) are never served to games.
SERVER_LIBRARIES = {"hits": "hits:"}
LIBRARIES = tuple(SERVER_LIBRARIES)
DEFAULT_LIBRARY = "hits"


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
    connected: bool = True  # False once they drop out mid-game; removed when the game ends
    # Secret handed only to this player's client so it can reclaim the seat after a reconnect.
    token: str = field(default_factory=lambda: secrets.token_urlsafe(16))


@dataclass
class Round:
    title: str
    artist: str
    urls: list[str]  # stem files, all played together
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
    state: str = "lobby"  # lobby | playing | finished
    total_rounds: int = DEFAULT_ROUNDS
    max_players: int = DEFAULT_PLAYER_LIMIT
    round_number: int = 0
    playlist: list[int] = field(default_factory=list)
    current: Round | None = None
    task: asyncio.Task | None = None
    all_guessed: asyncio.Event = field(default_factory=asyncio.Event)
    next_at: float | None = None  # time.monotonic() when the next round starts after a result
    # Titles the wrong options are drawn from: the option songs listed in the lobby.
    title_pool: list[str] = field(default_factory=list)
    # The next game's option songs, drawn in the lobby and shown there ({"title", "artist", "credit"}); the playlist
    # is a hidden pick of total_rounds of them.
    option_ids: list[int] = field(default_factory=list)
    songs: list[dict] = field(default_factory=list)
    # Last round_prepare / round_end payloads, replayed to players who rejoin mid-game.
    prepare_payload: dict | None = None
    end_payload: dict | None = None
    # Songs played this game ({"title", "artist", "credit", "urls"}), revealed with the final scores.
    played: list[dict] = field(default_factory=list)
    library: str = DEFAULT_LIBRARY
    # Only songs by these artists, in these genres and languages play (any when empty).
    artists: list[str] = field(default_factory=list)
    genres: list[str] = field(default_factory=list)
    languages: list[str] = field(default_factory=list)
    # Only songs whose title, artist, genre or language contains this play (any when empty).
    search: str = ""
    # Songs in the library matching the filters; None until counted.
    pool_size: int | None = None

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
            "search": self.search,
            "poolSize": self.pool_size,
            "songs": self.songs,
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
        }

    def name_taken(self, name: str, sid: str) -> bool:
        # Players who dropped out mid-game don't hold on to their name.
        taken = [p.name for p in self.players.values() if p.connected and p.sid != sid]
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
        await self._use_default_library(room)
        result = await self._add_player(room, sid, name)
        room.host_token = room.players[sid].token
        return result

    async def join_room(self, sid: str, code: object, name: object) -> dict:
        name = _clean_name(name)
        if not name:
            return _error("Enter a name")
        room = self.rooms.get(str(code or "").strip().upper())
        if not room:
            return _error("Room not found")
        if room.name_taken(name, sid):
            return _error("That name is taken in this room")
        if room.state == "playing":
            return _error("This game has already started")
        if len(room.players) >= room.max_players:
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

    async def rejoin(self, sid: str, code: object, token: object) -> dict:
        room = self.rooms.get(str(code or "").strip().upper())
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
        if not room.prepare_payload:
            return
        await self.sio.emit("round_prepare", {**room.prepare_payload, "resume": True}, to=sid)
        rnd = room.current
        now = time.monotonic()
        if rnd:
            player = room.players.get(sid)
            payload = {"duration": max(0.0, rnd.ends_at - now), "options": rnd.options,
                       "choice": player.choice if player else None}
            await self.sio.emit("round_start", payload, to=sid)
        elif room.next_at and room.end_payload:
            await self.sio.emit("round_end", {**room.end_payload, "nextIn": max(0.0, room.next_at - now)}, to=sid)

    async def leave(self, sid: str) -> None:
        code = self.sid_room.pop(sid, None)
        room = self.rooms.get(code) if code else None
        if not room:
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
            await self.sio.emit("room_closed", {}, room=room.code)
            del self.rooms[room.code]
            return
        if room.host_sid == sid:
            room.host_sid = room.active()[0].sid
            if room.state != "playing":
                # The old host left for good (not a mid-game drop they can rejoin from).
                room.host_token = room.players[room.host_sid].token
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
        search = (filters or {}).get("search")
        if search is not None:
            search = clean_search(search)
            if search is None:
                return _error("Invalid search")
        room.total_rounds = rounds
        room.max_players = max_players
        if library is not None and library != room.library:
            room.library = library
            # Another library has other artists, genres and languages.
            room.set_filters(no_filters())
            room.search = ""
        room.set_filters(chosen)
        if search is not None:
            room.search = search
        if library is not None or chosen or search is not None:
            await self._count_pool(room)
        elif len(room.playlist) != min(room.total_rounds, len(room.option_ids)):
            await self._draw_songs(room)
        await self._broadcast_state(room)
        return {"ok": True}

    async def _use_default_library(self, room: Room) -> None:
        room.library = DEFAULT_LIBRARY
        await self._count_pool(room)

    async def _count_pool(self, room: Room) -> None:
        """Counts the songs matching the filters and draws the next game's songs from them."""
        song_ids = await asyncio.to_thread(self._playable_song_ids, room.library, room.filters(), room.search)
        room.pool_size = len(song_ids)
        await self._draw_songs(room, song_ids)

    async def _draw_songs(self, room: Room, song_ids: list[int] | None = None) -> None:
        """Picks the next game's option songs (shown in the lobby) from the matches, and secretly its rounds' songs
        from those: its full length, or every option when the filters leave fewer."""
        if song_ids is None:
            song_ids = await asyncio.to_thread(self._playable_song_ids, room.library, room.filters(), room.search)
        room.option_ids = random.sample(song_ids, min(max(OPTION_LIST_SIZE, room.total_rounds), len(song_ids)))
        room.playlist = random.sample(room.option_ids, min(room.total_rounds, len(room.option_ids)))
        # Listed in their own random order, which says nothing about which of them play.
        room.songs = await asyncio.to_thread(self._song_names, room.option_ids)

    @staticmethod
    def _song_names(song_ids: list[int]) -> list[dict]:
        with SessionLocal() as db:
            names = {s.id: {"title": s.title, "artist": s.artist, "credit": s.credit}
                     for s in db.execute(select(Song.id, Song.title, Song.artist, Song.credit)
                                         .where(Song.id.in_(song_ids)))}
        return [names[i] for i in song_ids if i in names]

    @staticmethod
    def _with_options(rnd: Round, pool: list[str]) -> Round:
        """Fills in the multiple-choice options: the right title plus up to three others from the game's songs."""
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

    # ----- game flow -----

    async def library_sizes(self) -> dict[str, int]:
        return await asyncio.to_thread(self._library_sizes)

    @staticmethod
    def _library_sizes() -> dict[str, int]:
        return {name: len(GameManager._playable_song_ids(name)) for name in SERVER_LIBRARIES}

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

    async def library_facets(self, library: object, search: object = None) -> dict:
        """Song counts per (artist, genre, language) in a server library, for its filters, each with the
        link of one of those songs for a cover. No titles. With a search, only the songs matching it count."""
        if library not in SERVER_LIBRARIES:
            return _error("Unknown song library")
        search = clean_search(search) if search is not None else ""
        if search is None:
            return _error("Invalid search")
        return {"ok": True, "facets": await asyncio.to_thread(self._library_facets, library, search)}

    @staticmethod
    def _library_facets(library: str, search: str = "") -> list[dict]:
        ids = GameManager._playable_song_ids(library, None, search)
        counts: dict[tuple[str, str, str], int] = {}
        links: dict[tuple[str, str, str], str] = {}
        with SessionLocal() as db:
            # By id, so a filter keeps the same cover from one request to the next.
            songs = select(Song.artist, Song.genre, Song.language, Song.credit).where(Song.id.in_(ids)).order_by(Song.id)
            for row in db.execute(songs):
                key = (row.artist, row.genre or "", row.language or "")
                counts[key] = counts.get(key, 0) + 1
                link = (row.credit or {}).get("url")
                if link:
                    links.setdefault(key, link)
        return [
            {"artist": a, "genre": g, "language": lang, "songs": n, "url": links.get((a, g, lang))}
            for (a, g, lang), n in counts.items()
        ]

    async def start_game(self, sid: str) -> dict:
        room = self._room_of(sid)
        if not room:
            return _error("You are not in a room")
        if room.host_sid != sid:
            return _error("Only the host can start the game")
        if room.state == "playing":
            return _error("Game already running")

        filtered = room.search or any(room.filters().values())
        by_filters = " matching the filters" if filtered else " in the library"
        # The rounds play a hidden pick of the option songs shown in the lobby; the options are only their titles.
        if not room.playlist:
            await self._draw_songs(room)
        if len(room.playlist) < MIN_ROUNDS:
            return _error(f"Games need at least {MIN_ROUNDS} songs{by_filters} (there are {len(room.playlist)}).")
        room.title_pool = await asyncio.to_thread(self._titles, room.option_ids)
        room.round_number = 0
        room.played = []
        for p in room.players.values():
            p.score = 0
            p.guessed = p.attempted = False
            p.choice = None
        room.state = "playing"
        room.task = asyncio.create_task(self._run_game(room))
        return {"ok": True}

    @staticmethod
    def _playable_song_ids(library: str, filters: Filters | None = None, search: str = "") -> list[int]:
        prefix = SERVER_LIBRARIES[library]
        keep = song_filter(filters)
        found = search_test(search)
        with SessionLocal() as db:
            query = (select(Song.id, Song.title, Song.artist, Song.genre, Song.language).join(Stem)
                     .where(Song.source_file.startswith(prefix), Song.hidden.is_(False)).distinct())
            return [r.id for r in db.execute(query) if keep(r.artist, r.genre, r.language)
                    and found(r.title, r.artist, r.genre, r.language)]

    @staticmethod
    def _titles(song_ids: list[int]) -> list[str]:
        with SessionLocal() as db:
            return list(db.scalars(select(Song.title).where(Song.id.in_(song_ids))))

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
            for song_id in room.playlist:
                if not room.active():
                    return
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

    async def _play_round(self, room: Room, rnd: Round) -> None:
        room.round_number += 1
        room.all_guessed.clear()
        for p in room.players.values():
            p.guessed = p.attempted = False
            p.choice = None
            p.round_points = 0
        await self._broadcast_state(room)

        room.end_payload = None
        room.prepare_payload = {"round": room.round_number, "totalRounds": len(room.playlist), "urls": rnd.urls}
        await self.sio.emit("round_prepare", room.prepare_payload, room=room.code)
        await asyncio.sleep(config.PREPARE_SECONDS)

        room.current = rnd
        rnd.duration = config.ROUND_SECONDS
        rnd.ends_at = time.monotonic() + rnd.duration
        # Clients loop the clip until the countdown runs out, so the round length doesn't depend on it.
        await self.sio.emit("round_start", {"duration": rnd.duration, "options": rnd.options}, room=room.code)
        everyone_answered = await _wait_event(room.all_guessed, rnd.duration + AUDIO_START_GRACE)

        room.current = None
        winners = [p for p in room.players.values() if p.guessed]
        room.end_payload = {
            "title": rnd.title,
            "artist": rnd.artist,
            "credit": rnd.credit,
            "options": rnd.options,
            "correct": rnd.correct,
            "isLast": room.round_number >= len(room.playlist),
            "winners": [p.name for p in winners],
            "points": {p.name: p.round_points for p in winners},
        }
        room.played.append({"title": rnd.title, "artist": rnd.artist, "credit": rnd.credit, "urls": rnd.urls})
        # Once everyone has answered the next round starts getting ready at once; the client keeps the answer on
        # screen through it. The last round has no next one to show it, so its result always gets its time.
        wait = 0.0 if everyone_answered and not room.end_payload["isLast"] else config.RESULT_SECONDS
        room.next_at = time.monotonic() + wait
        await self.sio.emit("round_end", {**room.end_payload, "nextIn": wait}, room=room.code)
        if wait:
            await asyncio.sleep(wait)
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
        await self._draw_songs(room)  # the next game gets new songs
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

        player.attempted = True
        player.choice = option
        if option == rnd.correct:
            player.guessed = True
            # Faster answers score more: MAX_POINTS at the start, 1 point at the buzzer.
            left = min(1.0, max(0.0, (rnd.ends_at - time.monotonic()) / rnd.duration))
            player.round_points = 1 + round((MAX_POINTS - 1) * left)
            player.score += player.round_points
            result = "correct"
        else:
            result = "wrong"

        await self._broadcast_state(room)
        self._check_all_guessed(room)
        return {"ok": True, "result": result}

    def _check_all_guessed(self, room: Room) -> None:
        active = room.active()
        if room.current and active and all(p.attempted for p in active):
            room.all_guessed.set()
