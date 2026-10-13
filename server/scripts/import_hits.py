"""Add the "Preview of hits" library: vocal-free stems of popular songs, credited with their YouTube video.

From server/:  python -m scripts.import_hits

Songs are listed in scripts/hits.json ({"artist", "title", "file", "youtube"}). Each song's loudest
CLIP_SECONDS are cut and split with Demucs (free, runs on this machine) into drums, bass and other;
the vocals are dropped. Demucs needs PyTorch, so it runs in its own environment, set with
DEMUCS_PYTHON (default: ~/stem-sep/Scripts/python). Songs without a file are listed as pending.
Already imported songs are skipped. Run scripts.publish_cc --prefix hits: to put them live.
"""

import json
import os
import secrets
import subprocess
import sys
import tempfile
from pathlib import Path

from sqlalchemy import select

from app import config
from app.db import SessionLocal, init_db
from app.models import Song, Stem
from scripts.process_songs import FFMPEG, clip_start, duration_of, export_stem, is_silent, slug

HITS = Path(__file__).with_name("hits.json")
SEPARATE = Path(__file__).with_name("separate.py")
DEMUCS_PYTHON = os.environ.get("DEMUCS_PYTHON") or str(Path.home() / "stem-sep" / "Scripts" / "python")
DEMUCS_RATE = 44100


def add_song(hit: dict, source: str) -> int:
    src = Path(hit["file"])
    song_dir = config.MEDIA_DIR / "songs" / secrets.token_hex(8)
    with tempfile.TemporaryDirectory() as tmp:
        clip = Path(tmp) / "clip.wav"
        subprocess.run([FFMPEG, "-y", "-v", "error", "-ss", f"{clip_start(src):.2f}", "-t", str(config.CLIP_SECONDS),
                        "-i", str(src), "-vn", "-ac", "2", "-ar", str(DEMUCS_RATE), str(clip)], check=True)
        stems_dir = Path(tmp) / "stems"
        subprocess.run([DEMUCS_PYTHON, str(SEPARATE), str(clip), str(stems_dir)], check=True)
        song_dir.mkdir(parents=True, exist_ok=True)
        stems = []
        for wav in sorted(stems_dir.glob("*.wav")):
            mp3 = export_stem(wav, song_dir / wav.stem, 0)
            if is_silent(mp3):
                mp3.unlink()
            else:
                stems.append(mp3)
    if not stems:
        song_dir.rmdir()
        raise RuntimeError("every stem is silent")
    with SessionLocal() as db:
        song = Song(title=hit["title"], artist=hit["artist"], aliases=[], source_file=source,
                    duration=duration_of(stems[0]),
                    credit={"text": f"\u201c{hit['title']}\u201d by {hit['artist']} on YouTube", "url": hit["youtube"]})
        song.stems = [Stem(name=p.stem, path=p.relative_to(config.MEDIA_DIR).as_posix()) for p in stems]
        db.add(song)
        db.commit()
    return len(stems)


def main() -> None:
    if not FFMPEG:
        sys.exit("ffmpeg is needed to cut the clips.")
    hits = json.loads(HITS.read_text(encoding="utf-8"))
    init_db()
    with SessionLocal() as db:
        done = set(db.scalars(select(Song.source_file).where(Song.source_file.startswith("hits:"))))
    pending = []
    for hit in hits:
        source = f"hits:{slug(hit['artist'])}:{slug(hit['title'])}"
        if source in done:
            continue
        if not hit.get("file") or not Path(hit["file"]).exists():
            pending.append(hit)
            continue
        print(f"adding: {hit['title']} - {hit['artist']}", flush=True)
        try:
            print(f"  {add_song(hit, source)} stems", flush=True)
        except Exception as exc:
            print(f"  failed: {exc}", flush=True)
    for hit in pending:
        print(f"pending (no audio file): {hit['title']} - {hit['artist']}  {hit['youtube']}")


if __name__ == "__main__":
    main()
