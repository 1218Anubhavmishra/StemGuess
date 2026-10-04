"""Turn local audio files into cached, game-ready stems using Music.ai.

1. Put audio files in server/songs_input/ named "Artist - Title.mp3".
   Optional sidecar "Artist - Title.json": {"aliases": ["Alternate title"]}
2. Set MUSIC_AI_API_KEY and MUSIC_AI_WORKFLOW in server/.env.
3. From server/:  python -m scripts.process_songs

Files already in the database are skipped, so each song is only paid for once.
With ffmpeg on PATH, stems are clipped to CLIP_SECONDS, converted to MP3 and
silent stems (e.g. "piano" in a song without piano) are dropped.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx
from sqlalchemy import select

from app import config
from app.db import SessionLocal, init_db
from app.models import Song, Stem

AUDIO_EXTS = {".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac"}
POLL_SECONDS = 5
SILENCE_DB = -45.0

FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")


class MusicAi:
    def __init__(self, api_key: str, base_url: str):
        self.http = httpx.Client(base_url=base_url, headers={"Authorization": api_key}, timeout=60)

    def upload(self, path: Path) -> str:
        urls = self.http.get("/upload").raise_for_status().json()
        httpx.put(urls["uploadUrl"], content=path.read_bytes(), timeout=600).raise_for_status()
        return urls["downloadUrl"]

    def run_job(self, name: str, workflow: str, input_url: str) -> dict:
        job_id = (
            self.http.post("/job", json={"name": name, "workflow": workflow, "params": {"inputUrl": input_url}})
            .raise_for_status()
            .json()["id"]
        )
        while True:
            job = self.http.get(f"/job/{job_id}").raise_for_status().json()
            if job["status"] == "SUCCEEDED":
                return job
            if job["status"] == "FAILED":
                raise RuntimeError(f"Music.ai job failed: {job.get('error')}")
            time.sleep(POLL_SECONDS)

    def delete_job(self, job_id: str) -> None:
        self.http.delete(f"/job/{job_id}")


def parse_name(path: Path) -> tuple[str, str]:
    if " - " in path.stem:
        artist, title = path.stem.split(" - ", 1)
        return artist.strip(), title.strip()
    return "", path.stem.strip()


def load_aliases(path: Path) -> list[str]:
    sidecar = path.with_suffix(".json")
    if not sidecar.exists():
        return []
    data = json.loads(sidecar.read_text(encoding="utf-8"))
    return [str(a) for a in data.get("aliases", [])]


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_") or "stem"


def download(url: str, dest: Path) -> None:
    with httpx.stream("GET", url, timeout=600, follow_redirects=True) as res:
        res.raise_for_status()
        with dest.open("wb") as f:
            for chunk in res.iter_bytes():
                f.write(chunk)


def duration_of(path: Path) -> float | None:
    if not FFPROBE:
        return None
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True,
        text=True,
    )
    try:
        return float(out.stdout.strip())
    except ValueError:
        return None


def clip_start(source: Path) -> float:
    duration = duration_of(source)
    if not duration or config.CLIP_SECONDS <= 0 or duration <= config.CLIP_SECONDS:
        return 0.0
    return min(duration * 0.3, duration - config.CLIP_SECONDS)


def export_stem(src: Path, dest_base: Path, start: float) -> Path:
    if not FFMPEG:
        dest = dest_base.with_suffix(src.suffix or ".wav")
        shutil.move(src, dest)
        return dest
    dest = dest_base.with_suffix(".mp3")
    cmd = [FFMPEG, "-y", "-v", "error"]
    if config.CLIP_SECONDS > 0:
        cmd += ["-ss", f"{start:.2f}", "-t", str(config.CLIP_SECONDS)]
    cmd += ["-i", str(src), "-vn", "-ac", "2", "-b:a", "160k", str(dest)]
    subprocess.run(cmd, check=True)
    return dest


def is_silent(path: Path) -> bool:
    if not FFMPEG:
        return False
    out = subprocess.run(
        [FFMPEG, "-v", "info", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"],
        capture_output=True,
        text=True,
    )
    match = re.search(r"max_volume:\s*(-?[\d.]+|-inf) dB", out.stderr)
    if not match:
        return False
    return match.group(1) == "-inf" or float(match.group(1)) < SILENCE_DB


def process(client: MusicAi, path: Path) -> int:
    artist, title = parse_name(path)
    input_url = client.upload(path)
    job = client.run_job(f"stem-guess: {path.stem}", config.MUSIC_AI_WORKFLOW, input_url)
    outputs = {
        key: value
        for key, value in (job.get("result") or {}).items()
        if isinstance(value, str) and value.startswith("http")
    }
    if not outputs:
        raise RuntimeError(f"Workflow returned no file outputs: {job.get('result')}")

    start = clip_start(path)
    saved = 0
    with SessionLocal() as db:
        song = Song(title=title, artist=artist, aliases=load_aliases(path), source_file=path.name)
        db.add(song)
        db.flush()
        song_dir = config.MEDIA_DIR / "songs" / str(song.id)
        song_dir.mkdir(parents=True, exist_ok=True)

        with tempfile.TemporaryDirectory() as tmp:
            for key, url in outputs.items():
                name = slug(key)
                raw = Path(tmp) / f"{name}{Path(urlparse(url).path).suffix or '.wav'}"
                download(url, raw)
                final = export_stem(raw, song_dir / name, start)
                if is_silent(final):
                    final.unlink()
                    print(f"  skipped silent stem: {name}")
                    continue
                db.add(Stem(song_id=song.id, name=name, path=final.relative_to(config.MEDIA_DIR).as_posix()))
                saved += 1

        if saved == 0:
            raise RuntimeError("All stems were silent")
        db.commit()

    client.delete_job(job["id"])
    return saved


def main() -> None:
    if not config.MUSIC_AI_API_KEY or not config.MUSIC_AI_WORKFLOW:
        sys.exit("Set MUSIC_AI_API_KEY and MUSIC_AI_WORKFLOW in server/.env first.")

    init_db()
    config.SONGS_INPUT_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in config.SONGS_INPUT_DIR.iterdir() if p.suffix.lower() in AUDIO_EXTS)
    if not files:
        print(f"No audio files found in {config.SONGS_INPUT_DIR}")
        return
    if not FFMPEG:
        print("ffmpeg not found: stems will be kept full-length/uncompressed and silent stems won't be filtered.")

    with SessionLocal() as db:
        done = set(db.scalars(select(Song.source_file)))

    client = MusicAi(config.MUSIC_AI_API_KEY, config.MUSIC_AI_BASE_URL)
    for path in files:
        if path.name in done:
            print(f"skip (already processed): {path.name}")
            continue
        print(f"processing: {path.name}")
        try:
            count = process(client, path)
            print(f"  saved {count} stems")
        except Exception as exc:
            print(f"  failed: {exc}")


if __name__ == "__main__":
    main()
