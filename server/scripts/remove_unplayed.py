"""Remove every song the game doesn't play: songs outside the hits library (e.g. the old demo and Creative
Commons songs) and hidden hits. Only the songs a game can draw stay.

From server/:  python -m scripts.remove_unplayed [--dry-run]

Works on DATABASE_URL (local SQLite for testing, the live database for publishing). Each removed song's
row and stems go. Clip files on this machine aren't deleted but moved to TRASH (so they can be brought
back by hand); clips on R2 are deleted from the bucket. Removed hits also move from hits.csv to
hits_removed.csv, so imports don't add them again. The demo songs' generated audio (media/demo) moves to
TRASH too.
"""

import csv
import shutil
import sys
import time
from pathlib import Path

from sqlalchemy import select

from app import config
from app.db import SessionLocal, init_db
from app.models import Song
from scripts.import_hits import HITS, read_hits, source_of

PLAYED = "hits:"
TRASH = Path(__file__).resolve().parents[2] / "env" / "tmp" / f"removed_songs_{time.strftime('%Y%m%d_%H%M%S')}"
REMOVED_CSV = HITS.with_name("hits_removed.csv")


def r2_client():
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=f"https://{config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=config.R2_ACCESS_KEY_ID,
        aws_secret_access_key=config.R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


def main() -> None:
    dry = "--dry-run" in sys.argv
    init_db()
    with SessionLocal() as db:
        songs = [s for s in db.scalars(select(Song)) if not s.source_file.startswith(PLAYED) or s.hidden]
        kept = db.query(Song).count() - len(songs)
        by_kind: dict[str, int] = {}
        for s in songs:
            kind = "hidden hits" if s.source_file.startswith(PLAYED) else s.source_file.split(":")[0] + ":"
            by_kind[kind] = by_kind.get(kind, 0) + 1
        print(f"removing {len(songs)} songs ({', '.join(f'{n} {k}' for k, n in sorted(by_kind.items()))}); "
              f"{kept} stay")
        if dry:
            return
        remote = [st.path for s in songs for st in s.stems if st.path.startswith("http")]
        local_dirs = {(config.MEDIA_DIR / st.path).parent for s in songs for st in s.stems
                      if not st.path.startswith("http")}
        removed_sources = {s.source_file for s in songs}
        for s in songs:
            db.delete(s)
        db.commit()
    print(f"deleted {len(songs)} songs from the database")

    if remote:
        if not (config.R2_BUCKET and config.R2_PUBLIC_URL):
            print(f"{len(remote)} clips on R2 left in place: R2 settings missing in server/.env")
        else:
            s3 = r2_client()
            prefix = f"{config.R2_PUBLIC_URL}/"
            keys = [p.removeprefix(prefix) for p in remote if p.startswith(prefix)]
            for start in range(0, len(keys), 1000):
                s3.delete_objects(Bucket=config.R2_BUCKET,
                                  Delete={"Objects": [{"Key": k} for k in keys[start:start + 1000]]})
            print(f"deleted {len(keys)} clips from R2")

    moved = 0
    for folder in [*local_dirs, config.MEDIA_DIR / "demo"]:
        if folder.is_dir() and folder != config.MEDIA_DIR:
            dest = TRASH / folder.relative_to(config.MEDIA_DIR)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(folder), str(dest))
            moved += 1
    if moved:
        print(f"moved {moved} clip folders to {TRASH}")

    hits = read_hits()
    gone = [h for h in hits if source_of(h) in removed_sources]
    if gone:
        fields = list(hits[0])
        old = read_hits(REMOVED_CSV) if REMOVED_CSV.exists() else []
        for path, rows in ((HITS, [h for h in hits if source_of(h) not in removed_sources]), (REMOVED_CSV, old + gone)):
            with path.open("w", encoding="utf-8", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
                writer.writeheader()
                writer.writerows(rows)
        print(f"moved {len(gone)} rows from {HITS.name} to {REMOVED_CSV.name}")


if __name__ == "__main__":
    main()
