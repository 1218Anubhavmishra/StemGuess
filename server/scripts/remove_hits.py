"""Remove "Preview of hits" songs, e.g. ones whose vocals Demucs couldn't take out.

From server/:  python -m scripts.remove_hits <YouTube id> [<YouTube id> ...]

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
from scripts.import_hits import HITS, video_id
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


def delete_songs(ids: set[str]) -> None:
    s3 = None
    with SessionLocal() as db:
        sources = [f"hits:yt:{i}" for i in ids]
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


def move_rows(ids: set[str]) -> None:
    with HITS.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fields, rows = reader.fieldnames, list(reader)
    keep = [r for r in rows if video_id(r["youtube"].strip()) not in ids]
    moved = [r for r in rows if video_id(r["youtube"].strip()) in ids]
    if not moved:
        return
    new_file = not REJECTED.exists()
    with REJECTED.open("a", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        if new_file:
            writer.writeheader()
        writer.writerows(moved)
    with HITS.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(keep)
    print(f"{len(moved)} rows moved to {REJECTED.name}")


def main() -> None:
    ids = set(sys.argv[1:])
    if not ids:
        sys.exit("Usage: python -m scripts.remove_hits <YouTube id> [<YouTube id> ...]")
    delete_songs(ids)
    move_rows(ids)


if __name__ == "__main__":
    main()
