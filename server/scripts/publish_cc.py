"""Copy the Creative Commons songs from a local database to the live one, uploading their clips to R2.

From server/:  python -m scripts.publish_cc sqlite:///C:/path/to/stemguess.db

The target is DATABASE_URL from server/.env (the live database). Only "cc:" songs are copied, so
nothing else on the local machine is ever uploaded. Songs already in the target are skipped.
"""

import mimetypes
import sys

import boto3
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app import config
from app.db import SessionLocal, init_db
from app.models import Song, Stem


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("Usage: python -m scripts.publish_cc <source database URL>")
    source_url = sys.argv[1]
    if source_url == config.DATABASE_URL:
        sys.exit("Source and target are the same database.")
    required = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_URL")
    if missing := [name for name in required if not getattr(config, name)]:
        sys.exit(f"Set {', '.join(missing)} in server/.env first.")
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=config.R2_ACCESS_KEY_ID,
        aws_secret_access_key=config.R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )

    init_db()
    with SessionLocal() as live:
        existing = set(live.scalars(select(Song.source_file).where(Song.source_file.startswith("cc:"))))
    with Session(create_engine(source_url)) as local:
        songs = local.scalars(select(Song).where(Song.source_file.startswith("cc:"))).all()
        added = 0
        for song in songs:
            if song.source_file in existing:
                continue
            stems = []
            for stem in song.stems:
                path = stem.path
                if not path.startswith("http"):
                    file = config.MEDIA_DIR / path
                    content_type = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
                    s3.upload_file(str(file), config.R2_BUCKET, path, ExtraArgs={
                        "ContentType": content_type, "CacheControl": "public, max-age=31536000, immutable"})
                    path = f"{config.R2_PUBLIC_URL}/{path}"
                stems.append(Stem(name=stem.name, path=path))
            with SessionLocal() as live:
                live.add(Song(title=song.title, artist=song.artist, aliases=list(song.aliases or []),
                              source_file=song.source_file, duration=song.duration, credit=song.credit,
                              stems=stems))
                live.commit()
            added += 1
            print(f"published: {song.title} - {song.artist}", flush=True)
    print(f"done, {added} songs published ({len(songs) - added} already live)")


if __name__ == "__main__":
    main()
