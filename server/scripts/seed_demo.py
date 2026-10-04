"""Add two synthetic demo songs (generated tones, no Music.ai needed) for testing.

From server/:  python -m scripts.seed_demo
"""

import math
import random
import struct
import wave

from sqlalchemy import select

from app import config
from app.db import SessionLocal, init_db
from app.models import Song, Stem

RATE = 22050
SECONDS = 16

DEMOS = {
    "Demo Tune Alpha": {"root": 220.0, "bpm": 100},
    "Demo Tune Beta": {"root": 261.63, "bpm": 128},
}


def write_wav(path, samples):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in samples))


def make_stems(root: float, bpm: int) -> dict[str, list[float]]:
    beat = 60 / bpm
    n = RATE * SECONDS
    drums, bass, keys, vocals = [], [], [], []
    melody = [0, 4, 7, 12, 7, 4, 2, 5]
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


def main() -> None:
    init_db()
    with SessionLocal() as db:
        existing = set(db.scalars(select(Song.source_file)))
        for title, params in DEMOS.items():
            source = f"demo:{title}"
            if source in existing:
                print(f"skip: {title}")
                continue
            song = Song(title=title, artist="Stem Guess", aliases=[], source_file=source)
            db.add(song)
            db.flush()
            song_dir = config.MEDIA_DIR / "songs" / str(song.id)
            song_dir.mkdir(parents=True, exist_ok=True)
            for name, samples in make_stems(**params).items():
                path = song_dir / f"{name}.wav"
                write_wav(path, samples)
                db.add(Stem(song_id=song.id, name=name, path=path.relative_to(config.MEDIA_DIR).as_posix()))
            print(f"added: {title}")
        db.commit()


if __name__ == "__main__":
    main()
