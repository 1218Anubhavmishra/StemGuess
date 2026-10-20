"""Remove "Preview of hits" songs, e.g. ones whose vocals Demucs couldn't take out.

From server/:  python -m scripts.remove_hits <YouTube id or song source> [...]

A song is named by its YouTube video id, or by its full source ("hits:yt:...", "hits:link:..." or "hits:file:...").
Deletes the songs from the database in DATABASE_URL along with their stem files (local media or R2
objects), and moves their rows from hits.csv to hits_rejected.csv so import_hits doesn't add them
again. Run it once against the local database and once against the live one.
"""

import csv
import shutil
import sys
from pathlib import Path

import boto3
from sqlalchemy import select

from app import config
from app.db import SessionLocal
from app.models import Song
from scripts.import_hits import HITS, read_hits, source_of
from scripts.progress import Progress

REJECTED = HITS.with_name("hits_rejected.csv")


def r2_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=config.R2_ACCESS_KEY_ID,
        aws_secret_access_key=config.R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


def delete_songs(sources: set[str]) -> None:
    s3 = None
    with SessionLocal() as db:
        songs = db.scalars(select(Song).where(Song.source_file.in_(sources))).all()
        progress = Progress(len(songs), "songs to remove")
        for song in songs:
            for stem in song.stems:
                if stem.path.startswith("http"):
                    s3 = s3 or r2_client()
                    s3.delete_object(Bucket=config.R2_BUCKET, Key=stem.path.removeprefix(f"{config.R2_PUBLIC_URL}/"))
                else:
                    (config.MEDIA_DIR / stem.path).unlink(missing_ok=True)
            folder = config.MEDIA_DIR / Path(song.stems[0].path).parent if song.stems else None
            if folder and not song.stems[0].path.startswith("http") and folder.is_dir() and not any(folder.iterdir()):
                shutil.rmtree(folder)
            db.delete(song)
            progress.step(f"removed: {song.title} - {song.artist}")
        db.commit()


def move_rows(sources: set[str]) -> None:
    rows = read_hits()
    keep = [r for r in rows if source_of(r) not in sources]
    moved = [r for r in rows if source_of(r) in sources]
    if not moved:
        return
    fields = list(rows[0].keys())
    rejected = read_hits(REJECTED) if REJECTED.exists() else []
    rejected_fields = list(rejected[0].keys()) if rejected else []
    rejected_fields += [f for f in fields if f not in rejected_fields]
    with REJECTED.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=rejected_fields, restval="")
        writer.writeheader()
        writer.writerows(rejected + moved)
    with HITS.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(keep)
    print(f"{len(moved)} rows moved to {REJECTED.name}")


def main() -> None:
    sources = {a if a.startswith("hits:") else f"hits:yt:{a}" for a in sys.argv[1:]}
    if not sources:
        sys.exit("Usage: python -m scripts.remove_hits <YouTube id or song source> [...]")
    delete_songs(sources)
    move_rows(sources)


if __name__ == "__main__":
    main()
