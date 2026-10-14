"""Run "Preview of hits" songs whose vocals leaked through Demucs a second time.

From server/:  python -m scripts.reseparate_hits <song source> [...]

Each song's stems are mixed back together and split again with Demucs (separate.py), dropping the
vocals Demucs finds this time. The new stems go in a new folder (clips are cached as immutable, so a
changed clip needs a new path) and replace the old ones in DATABASE_URL. publish_cc then uploads the
new clips for songs that are already live.
"""

import json
import secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from sqlalchemy import select

from app import config
from app.db import SessionLocal
from app.models import Song, Stem
from scripts.import_hits import DEMUCS_PYTHON, DEMUCS_RATE, SEPARATE
from scripts.process_songs import FFMPEG, duration_of, export_stem, is_silent
from scripts.progress import Progress


def mix(stems: list[Path], dest: Path) -> None:
    inputs = [arg for stem in stems for arg in ("-i", str(stem))]
    subprocess.run([FFMPEG, "-y", "-v", "error", *inputs, "-filter_complex",
                    f"amix=inputs={len(stems)}:normalize=0", "-ac", "2", "-ar", str(DEMUCS_RATE), str(dest)],
                   check=True)


def replace_stems(source: str, stems_dir: Path) -> int:
    with SessionLocal() as db:
        song = db.scalars(select(Song).where(Song.source_file == source)).one()
        old_dir = config.MEDIA_DIR / Path(song.stems[0].path).parent
        song_dir = config.MEDIA_DIR / "songs" / secrets.token_hex(8)
        song_dir.mkdir(parents=True)
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
        song.stems = [Stem(name=p.stem, path=p.relative_to(config.MEDIA_DIR).as_posix()) for p in stems]
        song.duration = duration_of(stems[0])
        db.commit()
    shutil.rmtree(old_dir, ignore_errors=True)
    return len(stems)


def main() -> None:
    sources = sys.argv[1:]
    if not sources:
        sys.exit("Usage: python -m scripts.reseparate_hits <song source> [...]")
    with SessionLocal() as db:
        songs = db.scalars(select(Song).where(Song.source_file.in_(sources))).all()
        songs = [(s.source_file, f"{s.title} - {s.artist}", [config.MEDIA_DIR / st.path for st in s.stems])
                 for s in songs if s.stems and not s.stems[0].path.startswith("http")]
    progress = Progress(len(songs), "songs to separate again")
    with tempfile.TemporaryDirectory() as tmp:
        jobs = []
        for i, (source, name, stems) in enumerate(songs):
            clip = Path(tmp) / f"{i}.wav"
            try:
                mix(stems, clip)
                jobs.append({"clip": str(clip), "out": str(Path(tmp) / f"{i}-stems"), "song": i})
            except subprocess.CalledProcessError as exc:
                progress.step(f"failed to mix {name}: {exc}")
        jobs_file = Path(tmp) / "jobs.json"
        jobs_file.write_text(json.dumps(jobs), encoding="utf-8")
        with subprocess.Popen([DEMUCS_PYTHON, str(SEPARATE), str(jobs_file)], stdout=subprocess.PIPE,
                              text=True, encoding="utf-8") as demucs:
            for line in demucs.stdout:
                status, _, rest = line.strip().partition(" ")
                job = next((j for j in jobs if rest == j["out"] or rest.startswith(j["out"] + ":")), None)
                if not job:
                    continue
                source, name, _ = songs[job["song"]]
                if status != "done":
                    progress.step(f"failed: {name}: {rest.removeprefix(job['out'] + ':').strip()}")
                    continue
                try:
                    progress.step(f"{replace_stems(source, Path(job['out']))} stems: {name}")
                except Exception as exc:
                    progress.step(f"failed: {name}: {exc}")


if __name__ == "__main__":
    main()
