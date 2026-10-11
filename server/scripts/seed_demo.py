"""Add 25 synthetic demo songs (generated tones, no Music.ai needed) for testing.

From server/:  python -m scripts.seed_demo               (write missing files + add songs to the database)
               python -m scripts.seed_demo --files-only  (just write missing files, e.g. during a deploy build)

Safe to run repeatedly: existing files are kept and existing songs are updated in place.
"""

import json
import math
import random
import secrets
import shutil
import struct
import sys
import wave
from pathlib import Path

from sqlalchemy import select

from app import config
from app.db import SessionLocal, init_db
from app.models import Song, Stem

RATE = 22050
SECONDS = 15
STEM_NAMES = ("drums", "bass", "keys", "vocals")

MELODIES = [
    [0, 4, 7, 12, 7, 4, 2, 5],
    [0, 2, 3, 7, 3, 2, 0, -2],
    [7, 5, 4, 0, 4, 5, 7, 9],
    [0, 0, 7, 7, 9, 9, 7, 5],
    [12, 11, 7, 4, 7, 11, 12, 14],
    [0, 3, 5, 7, 10, 7, 5, 3],
    [4, 2, 0, 2, 4, 4, 4, 7],
    [0, 7, 5, 3, 2, 3, 5, 7],
    [9, 7, 4, 2, 0, 2, 4, 9],
    [0, 5, 9, 12, 9, 5, 4, 2],
]

DEMOS = {
    "Demo Tune Alpha": {"root": 220.0, "bpm": 100, "melody": 0},
    "Demo Tune Beta": {"root": 261.63, "bpm": 128, "melody": 0},
    "Crimson Skyline": {"root": 196.0, "bpm": 92, "melody": 1},
    "Neon Harbor": {"root": 246.94, "bpm": 118, "melody": 2},
    "Velvet Thunder": {"root": 164.81, "bpm": 84, "melody": 3},
    "Paper Planets": {"root": 293.66, "bpm": 140, "melody": 4},
    "Midnight Arcade": {"root": 185.0, "bpm": 110, "melody": 2},
    "Copper Rain": {"root": 233.08, "bpm": 96, "melody": 1},
    "Glass Garden": {"root": 277.18, "bpm": 124, "melody": 3},
    "Lunar Parade": {"root": 207.65, "bpm": 132, "melody": 4},
    "Saffron Static": {"root": 220.0, "bpm": 104, "melody": 5},
    "Ocean Telephone": {"root": 174.61, "bpm": 88, "melody": 6},
    "Firefly Circuit": {"root": 261.63, "bpm": 136, "melody": 7},
    "Hollow Mountain": {"root": 146.83, "bpm": 78, "melody": 8},
    "Electric Monsoon": {"root": 233.08, "bpm": 126, "melody": 9},
    "Lantern Festival": {"root": 196.0, "bpm": 98, "melody": 6},
    "Silver Compass": {"root": 246.94, "bpm": 112, "melody": 5},
    "Cobalt Sunrise": {"root": 293.66, "bpm": 120, "melody": 9},
    "Desert Radio": {"root": 164.81, "bpm": 94, "melody": 7},
    "Marble Hearts": {"root": 277.18, "bpm": 116, "melody": 8},
    "Static Bloom": {"root": 185.0, "bpm": 130, "melody": 0},
    "Northern Echo": {"root": 207.65, "bpm": 86, "melody": 1},
    "Tangerine Drive": {"root": 311.13, "bpm": 138, "melody": 2},
    "Quiet Volcano": {"root": 155.56, "bpm": 82, "melody": 3},
    "Satellite Waltz": {"root": 233.08, "bpm": 108, "melody": 4},
}


DEMO_ROOT = config.MEDIA_DIR / "demo"
# Which random folder holds which song. Kept outside MEDIA_DIR because it maps folders to titles,
# so it must never be served.
INDEX_FILE = config.BASE_DIR / "demo_index.json"


def demo_dirs() -> dict[str, Path]:
    """Random folder per song (like processed songs), so stem URLs don't give the title away."""
    try:
        index = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        index = {}
    if set(index) != set(DEMOS):
        index = {title: index.get(title) or secrets.token_hex(8) for title in DEMOS}
        INDEX_FILE.write_text(json.dumps(index, indent=2), encoding="utf-8")
    return {title: DEMO_ROOT / folder for title, folder in index.items()}


def write_wav(path, samples):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in samples))


def make_stems(root: float, bpm: int, melody: int) -> dict[str, list[float]]:
    beat = 60 / bpm
    n = RATE * SECONDS
    drums, bass, keys, vocals = [], [], [], []
    melody = MELODIES[melody]
    for i in range(n):
        t = i / RATE
        pos = t % beat
        drums.append((random.uniform(-1, 1) * math.exp(-pos * 40)) * 0.6)
        bass_note = root / 2 * (1.5 if int(t / (beat * 4)) % 2 else 1)
        bass.append(math.sin(2 * math.pi * bass_note * t) * 0.4)
        keys.append(sum(math.sin(2 * math.pi * root * r * t) for r in (1, 1.26, 1.5)) * 0.12)
        note = root * 2 ** (melody[int(t / beat) % len(melody)] / 12)
        vocals.append(math.sin(2 * math.pi * note * 2 * t) * 0.3 * (1 - math.exp(-pos * 20)))
    return {"drums": drums, "bass": bass, "keys": keys, "vocals": vocals}


def write_files() -> None:
    folders = demo_dirs()
    # Older folders were named after the title's hash, which a player could recompute from the options.
    if DEMO_ROOT.exists():
        for old in DEMO_ROOT.iterdir():
            if old not in folders.values():
                shutil.rmtree(old, ignore_errors=True)
    for title, params in DEMOS.items():
        folder = folders[title]
        if all((folder / f"{name}.wav").exists() for name in STEM_NAMES):
            continue
        folder.mkdir(parents=True, exist_ok=True)
        for name, samples in make_stems(**params).items():
            write_wav(folder / f"{name}.wav", samples)
        print(f"wrote: {title}")


def register_songs() -> None:
    init_db()
    folders = demo_dirs()
    with SessionLocal() as db:
        for title in DEMOS:
            source = f"demo:{title}"
            song = db.scalar(select(Song).where(Song.source_file == source))
            if song is None:
                song = Song(title=title, artist="Stem Guess", aliases=[], source_file=source)
                db.add(song)
                print(f"added: {title}")
            folder = folders[title].relative_to(config.MEDIA_DIR).as_posix()
            song.stems = [Stem(name=name, path=f"{folder}/{name}.wav") for name in STEM_NAMES]
            song.duration = float(SECONDS)
        db.commit()


def main() -> None:
    write_files()
    if "--files-only" not in sys.argv:
        register_songs()


if __name__ == "__main__":
    main()
