"""Make every "Preview of hits" clip the song's opening CLIP_SECONDS with everything in it (all instruments and vocals).

From server/:  python -m scripts.full_mix_hits [--limit N] [--new] [--redo]

Each song in the database is cut again from its audio file in hits.csv: leading silence is skipped, then the
first CLIP_SECONDS become a single "mix" stem in a new folder (clips are cached as immutable). The old clip
folders are left on disk, so a backup of the database brings the earlier clips back. Songs already done
(listed in hits_full_mix.json) are skipped unless --redo is given, so a stopped run resumes where it left
off. --new also adds the songs in hits.csv that aren't in the database yet.
Publish with publish_cc --prefix hits: (it replaces changed clips).
"""

import json
import secrets
import subprocess
import sys
from pathlib import Path

from sqlalchemy import select

from app import config
from app.db import SessionLocal
from app.models import Song, Stem
from scripts.import_hits import HITS, credit_of, genres_of, read_hits, source_of
from scripts.process_songs import FFMPEG, duration_of, is_silent
from scripts.progress import Progress

DONE = HITS.with_name("hits_full_mix.json")
# Skips digital silence or near-silence before the song starts.
LEAD_SILENCE = "silenceremove=start_periods=1:start_duration=0.05:start_threshold=-50dB"


def cut(src: Path) -> Path:
    song_dir = config.MEDIA_DIR / "songs" / secrets.token_hex(8)
    song_dir.mkdir(parents=True)
    dest = song_dir / "mix.mp3"
    subprocess.run([FFMPEG, "-y", "-v", "error", "-i", str(src), "-vn", "-af", LEAD_SILENCE,
                    "-t", str(config.CLIP_SECONDS), "-ac", "2", "-b:a", "160k", str(dest)], check=True)
    if is_silent(dest):
        dest.unlink()
        song_dir.rmdir()
        raise RuntimeError("the clip is silent")
    return dest


def save(hit: dict, clip: Path) -> None:
    with SessionLocal() as db:
        song = db.scalars(select(Song).where(Song.source_file == source_of(hit))).one_or_none()
        if not song:
            song = Song(title=hit["title"], artist=hit["artist"], aliases=[], source_file=source_of(hit),
                        credit=credit_of(hit), genre=genres_of(hit), language=hit.get("language") or None)
            db.add(song)
        song.stems = [Stem(name="mix", path=clip.relative_to(config.MEDIA_DIR).as_posix())]
        song.duration = duration_of(clip)
        db.commit()


def main() -> None:
    if not FFMPEG:
        sys.exit("ffmpeg is needed to cut the clips.")
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 0
    done = set(json.loads(DONE.read_text(encoding="utf-8"))) if DONE.exists() and "--redo" not in sys.argv else set()
    with SessionLocal() as db:
        in_db = set(db.scalars(select(Song.source_file).where(Song.source_file.startswith("hits:"))))
    hits = [h for h in read_hits() if h.get("file") and Path(h["file"]).exists()]
    wanted = in_db | ({source_of(h) for h in hits} if "--new" in sys.argv else set())
    todo = list({source_of(h): h for h in reversed(hits) if source_of(h) in wanted - done}.values())[::-1]
    missing = in_db - {source_of(h) for h in hits}
    if missing:
        print(f"{len(missing)} songs in the database have no audio file in hits.csv and keep their clips")
    todo = todo[:limit] if limit else todo
    progress = Progress(len(todo), "songs this run")
    for hit in todo:
        try:
            save(hit, cut(Path(hit["file"])))
            done.add(source_of(hit))
            DONE.write_text(json.dumps(sorted(done), indent=0), encoding="utf-8")
            progress.step(f"{hit['title']} - {hit['artist']}")
        except Exception as exc:
            progress.step(f"failed: {hit['title']}: {exc}")


if __name__ == "__main__":
    main()
