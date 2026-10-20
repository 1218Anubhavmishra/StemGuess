"""Add the "Preview of hits" library: vocal-free stems of popular songs, credited with their YouTube video.

From server/:  python -m scripts.import_hits [--sync-only]

Songs are listed in scripts/hits.csv (title, artist, genre, language, youtube, file; file is empty
when there's no audio yet; genre and language choose songs for a game, see hits_genres). The youtube column holds the song's official YouTube video, or another official link
(e.g. Apple Music) when no YouTube upload plays; the link identifies a song, so titles and artists
can be edited there and re-synced. Each run:
1. updates the title, artist, genre, language and credit of songs already in the database (DATABASE_URL) to match
   hits.csv. --sync-only stops here, e.g. to rename songs in the live database;
2. imports the new songs: each song's loudest CLIP_SECONDS are cut and split with Demucs (free, runs
   on this machine) into drums, bass and other, dropping the vocals. Demucs needs PyTorch, so it
   runs in its own environment, set with DEMUCS_PYTHON (default: ~/stem-sep/Scripts/python), once
   per batch of BATCH songs so the model only loads once per batch.
Songs without an audio file are listed as pending. Publish new songs with publish_cc --prefix hits:.
"""

import csv
import hashlib
import json
import os
import secrets
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from sqlalchemy import select

from app import config
from app.db import SessionLocal, init_db
from app.models import Song, Stem
from scripts.process_songs import FFMPEG, clip_start, duration_of, export_stem, is_silent
from scripts.progress import Progress

HITS = Path(__file__).with_name("hits.csv")
SEPARATE = Path(__file__).with_name("separate.py")
DEMUCS_PYTHON = os.environ.get("DEMUCS_PYTHON") or str(Path.home() / "stem-sep" / "Scripts" / "python")
DEMUCS_RATE = 44100
BATCH = 50


SITES = {"youtube.com": "YouTube", "youtu.be": "YouTube", "music.apple.com": "Apple Music",
         "open.spotify.com": "Spotify"}


def video_id(url: str) -> str:
    return parse_qs(urlparse(url).query).get("v", [url])[0]


def site_of(url: str) -> str:
    host = urlparse(url).hostname or ""
    return next((name for domain, name in SITES.items() if host == domain or host.endswith("." + domain)), host)


def source_of(hit: dict) -> str:
    """A song's key: its YouTube video, its other official link, or for songs without a link, its file name."""
    if hit.get("youtube"):
        if site_of(hit["youtube"]) == "YouTube":
            return f"hits:yt:{video_id(hit['youtube'])}"
        return f"hits:link:{hashlib.sha1(hit['youtube'].encode()).hexdigest()[:16]}"
    return f"hits:file:{hashlib.sha1(Path(hit['file']).name.casefold().encode()).hexdigest()[:16]}"


def credit_of(hit: dict) -> dict:
    by = f" by {hit['artist']}" if hit["artist"] else ""
    if not hit.get("youtube"):
        return {"text": f"\u201c{hit['title']}\u201d{by}"}
    return {"text": f"\u201c{hit['title']}\u201d{by} on {site_of(hit['youtube'])}", "url": hit["youtube"]}


def read_hits(path: Path = HITS) -> list[dict]:
    # utf-8-sig: spreadsheet apps add a byte-order mark when saving.
    with path.open(encoding="utf-8-sig", newline="") as f:
        return [{k: (v or "").strip() for k, v in row.items()} for row in csv.DictReader(f)]


def sync(hits: list[dict]) -> None:
    by_source = {source_of(h): h for h in hits}
    with SessionLocal() as db:
        changed = 0
        for song in db.scalars(select(Song).where(Song.source_file.startswith("hits:"))):
            hit = by_source.get(song.source_file)
            if not hit:
                continue
            want = (hit["title"], hit["artist"], credit_of(hit), hit.get("genre") or None, hit.get("language") or None)
            if (song.title, song.artist, song.credit, song.genre, song.language) != want:
                print(f"update: {song.title} - {song.artist}  ->  {hit['title']} - {hit['artist']}"
                      f"  [{want[3] or '-'}, {want[4] or '-'}]")
                song.title, song.artist, song.credit, song.genre, song.language = want
                changed += 1
        db.commit()
    print(f"{changed} songs updated")


def import_batch(batch: list[dict], progress: Progress) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        jobs = []
        for i, hit in enumerate(batch):
            src = Path(hit["file"])
            clip = Path(tmp) / f"{i}.wav"
            try:
                subprocess.run([FFMPEG, "-y", "-v", "error", "-ss", f"{clip_start(src):.2f}", "-t",
                                str(config.CLIP_SECONDS), "-i", str(src), "-vn", "-ac", "2", "-ar", str(DEMUCS_RATE),
                                str(clip)], check=True)
                jobs.append({"clip": str(clip), "out": str(Path(tmp) / f"{i}-stems"), "hit": i})
            except subprocess.CalledProcessError as exc:
                progress.step(f"failed to cut {hit['title']}: {exc}")
        jobs_file = Path(tmp) / "jobs.json"
        jobs_file.write_text(json.dumps(jobs), encoding="utf-8")
        # separate.py prints "done <out>" or "failed <out>: <error>" as each clip finishes.
        with subprocess.Popen([DEMUCS_PYTHON, str(SEPARATE), str(jobs_file)], stdout=subprocess.PIPE,
                              text=True, encoding="utf-8") as demucs:
            for line in demucs.stdout:
                status, _, rest = line.strip().partition(" ")
                job = next((j for j in jobs if rest == j["out"] or rest.startswith(j["out"] + ":")), None)
                if not job:
                    continue
                hit = batch[job["hit"]]
                if status != "done":
                    progress.step(f"failed: {hit['title']}: {rest.removeprefix(job['out'] + ':').strip()}")
                    continue
                try:
                    progress.step(f"{add_song(hit, Path(job['out']))} stems: {hit['title']} - {hit['artist']}")
                except Exception as exc:
                    progress.step(f"failed: {hit['title']}: {exc}")
        if demucs.returncode:
            raise subprocess.CalledProcessError(demucs.returncode, demucs.args)


def add_song(hit: dict, stems_dir: Path) -> int:
    wavs = sorted(stems_dir.glob("*.wav"))
    if not wavs:
        raise RuntimeError("Demucs produced no stems")
    song_dir = config.MEDIA_DIR / "songs" / secrets.token_hex(8)
    song_dir.mkdir(parents=True, exist_ok=True)
    stems = []
    for wav in wavs:
        mp3 = export_stem(wav, song_dir / wav.stem, 0)
        if is_silent(mp3):
            mp3.unlink()
        else:
            stems.append(mp3)
    if not stems:
        song_dir.rmdir()
        raise RuntimeError("every stem is silent")
    with SessionLocal() as db:
        song = Song(title=hit["title"], artist=hit["artist"], aliases=[],
                    source_file=source_of(hit), duration=duration_of(stems[0]),
                    credit=credit_of(hit), genre=hit.get("genre") or None, language=hit.get("language") or None)
        song.stems = [Stem(name=p.stem, path=p.relative_to(config.MEDIA_DIR).as_posix()) for p in stems]
        db.add(song)
        db.commit()
    return len(stems)


def main() -> None:
    hits = read_hits()
    init_db()
    sync(hits)
    if "--sync-only" in sys.argv:
        return
    if not FFMPEG:
        sys.exit("ffmpeg is needed to cut the clips.")
    with SessionLocal() as db:
        done = set(db.scalars(select(Song.source_file).where(Song.source_file.startswith("hits:"))))
    todo, pending = [], []
    for hit in hits:
        if source_of(hit) in done:
            continue
        (todo if hit.get("file") and Path(hit["file"]).exists() else pending).append(hit)
    progress = Progress(len(todo), "songs to import")
    for start in range(0, len(todo), BATCH):
        import_batch(todo[start : start + BATCH], progress)
    for hit in pending:
        print(f"pending (no audio file): {hit['title']} - {hit['artist']}  {hit['youtube']}")


if __name__ == "__main__":
    main()
