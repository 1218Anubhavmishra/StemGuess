"""Add Creative Commons songs to the "cc" library from sources that need no account.

From server/:  python -m scripts.import_cc [--per-genre N]

- Incompetech (Kevin MacLeod): every track is CC BY 4.0. N tracks per genre.
- ccMixter: only tracks licensed CC BY (no NonCommercial / NoDerivatives). One per genre tag.

No Music.ai needed: games play all stems together, so each song is stored as a single "mix"
stem, cut to the song's loudest CLIP_SECONDS. Every song keeps its attribution (title, author,
source link, licence), which the game shows after the round. Already imported songs are skipped.
Run scripts.upload_r2 afterwards to host the clips on R2.
"""

from __future__ import annotations

import random
import re
import secrets
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote

import httpx
from sqlalchemy import func, select

from app import config
from app.db import SessionLocal, init_db
from app.models import Song, Stem
from scripts.process_songs import FFMPEG, clip_start, duration_of, export_stem, is_silent
from scripts.progress import Progress

INCOMPETECH_CATALOG = "https://incompetech.com/music/royalty-free/pieces.json"
INCOMPETECH_MP3 = "https://incompetech.com/music/royalty-free/mp3-royaltyfree/"
# Incompetech genre ids -> name (for logs). Stingers, holiday and unclassified tracks are left out.
INCOMPETECH_GENRES = {
    "2": "African", "3": "Blues", "5": "Folk / acoustic", "6": "Disco", "7": "Electronica", "8": "Funk",
    "10": "Dark / horror", "11": "Jazz", "12": "Latin", "13": "Ambient", "15": "Polka", "16": "Pop",
    "18": "R&B / soul", "19": "Rock", "20": "Classical / ragtime", "21": "Reggae / ska", "22": "Soundtrack",
    "25": "World",
}
CCMIXTER_API = "http://ccmixter.org/api/query"
CCMIXTER_TAGS = ["hip_hop", "trip_hop", "electronic", "rock", "ambient", "dubstep", "funk", "jazz", "reggae",
                 "piano", "acoustic", "chill", "techno", "folk"]
# Alternate takes, loops and edits would show up as near-duplicate answer options.
VARIANT = re.compile(r"\b(instrumental|loop|part|v\d|version|mix|sting|short|shorter|alternate|alt|edit|"
                     r"reprise|remix|no\s|without|trio|faster|slower|vocals?|\d+)\b| - |\(", re.I)
# ccMixter refuses downloads that don't look like they come from its own track page.
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
MIN_SECONDS, MAX_SECONDS = 90, 420


def seconds(length: str) -> int:
    try:
        h, m, s = (int(x) for x in length.split(":"))
        return h * 3600 + m * 60 + s
    except ValueError:
        return 0


def incompetech_picks(per_genre: int) -> list[dict]:
    pieces = httpx.get(INCOMPETECH_CATALOG, timeout=60, follow_redirects=True).raise_for_status().json()
    rng = random.Random("stemguess-cc")
    picks = []
    for genre_id, genre in INCOMPETECH_GENRES.items():
        pool = [p for p in pieces if p.get("genre") == genre_id and p.get("filename")
                and MIN_SECONDS <= seconds(p.get("length") or "") <= MAX_SECONDS and not VARIANT.search(p["title"])]
        rng.shuffle(pool)
        for p in pool[:per_genre]:
            picks.append({
                "source": f"cc:incompetech:{p['filename']}",
                "title": p["title"].strip(),
                "artist": "Kevin MacLeod",
                "url": INCOMPETECH_MP3 + quote(p["filename"]),
                "genre": genre,
                "credit": {
                    "text": f"\u201c{p['title'].strip()}\u201d by Kevin MacLeod (incompetech.com), excerpt",
                    "url": "https://incompetech.com/music/royalty-free/",
                    "license": "CC BY 4.0",
                    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
                },
            })
    return picks


def ccmixter_picks() -> list[dict]:
    picks, seen = [], set()
    for tag in CCMIXTER_TAGS:
        params = {"f": "json", "lic": "by", "sort": "rank", "limit": 8, "reqtags": tag}
        try:
            uploads = httpx.get(CCMIXTER_API, params=params, timeout=60).raise_for_status().json()
        except (httpx.HTTPError, ValueError) as exc:
            print(f"ccMixter {tag}: {exc}")
            continue
        for u in uploads:
            licence = u.get("license_url") or ""
            mp3 = next((f for f in u.get("files", []) if f.get("file_name", "").lower().endswith(".mp3")), None)
            length = seconds("0:" + (mp3 or {}).get("file_format_info", {}).get("ps", ""))
            title = (u.get("upload_name") or "").strip()
            if (u.get("upload_id") in seen or not mp3 or "/licenses/by/" not in licence or not title
                    or VARIANT.search(title) or not MIN_SECONDS <= length <= MAX_SECONDS):
                continue
            seen.add(u["upload_id"])
            artist = (u.get("user_real_name") or u.get("user_name") or "").strip()
            featuring = (u.get("upload_extra") or {}).get("featuring") or ""
            version = re.search(r"\d+(\.\d+)?", u.get("license_name") or "")
            picks.append({
                "source": f"cc:ccmixter:{u['upload_id']}",
                "title": title,
                "artist": artist,
                "url": mp3["download_url"],
                "headers": {"User-Agent": BROWSER_UA, "Referer": u.get("file_page_url") or "https://ccmixter.org/"},
                "genre": f"ccMixter {tag}",
                "credit": {
                    "text": f"\u201c{title}\u201d by {artist}" + (f" (ft. {featuring})" if featuring else "")
                    + " (ccmixter.org), excerpt",
                    "url": u.get("file_page_url"),
                    "license": f"CC BY {version.group(0)}" if version else "CC BY",
                    "licenseUrl": licence.replace("http://", "https://"),
                },
            })
            break
    return picks


def add_song(pick: dict) -> None:
    song_dir = config.MEDIA_DIR / "songs" / secrets.token_hex(8)
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "full.mp3"
        with httpx.stream("GET", pick["url"], headers=pick.get("headers"), timeout=600, follow_redirects=True) as res:
            res.raise_for_status()
            with raw.open("wb") as f:
                for chunk in res.iter_bytes():
                    f.write(chunk)
        song_dir.mkdir(parents=True, exist_ok=True)
        clip = export_stem(raw, song_dir / "mix", clip_start(raw))
    if is_silent(clip):
        clip.unlink()
        song_dir.rmdir()
        raise RuntimeError("clip is silent")
    with SessionLocal() as db:
        song = Song(title=pick["title"], artist=pick["artist"], aliases=[], source_file=pick["source"],
                    credit=pick["credit"], duration=duration_of(clip))
        song.stems = [Stem(name="mix", path=clip.relative_to(config.MEDIA_DIR).as_posix())]
        db.add(song)
        db.commit()


def main() -> None:
    if not FFMPEG:
        sys.exit("ffmpeg is needed to cut the clips.")
    per_genre = int(sys.argv[sys.argv.index("--per-genre") + 1]) if "--per-genre" in sys.argv else 2
    init_db()
    with SessionLocal() as db:
        done = set(db.scalars(select(Song.source_file).where(Song.source_file.startswith("cc:"))))
        titles = {t.casefold() for t in db.scalars(select(func.lower(Song.title)))}
    picks = [p for p in incompetech_picks(per_genre) + ccmixter_picks() if p["source"] not in done]
    progress = Progress(len(picks))
    for pick in picks:
        if pick["title"].casefold() in titles:
            progress.step(f"skip (title already used): {pick['title']}")
            continue
        try:
            add_song(pick)
            titles.add(pick["title"].casefold())
            progress.step(f"added [{pick['genre']}]: {pick['title']} - {pick['artist']}")
        except Exception as exc:
            progress.step(f"failed: {pick['title']}: {exc}")


if __name__ == "__main__":
    main()
