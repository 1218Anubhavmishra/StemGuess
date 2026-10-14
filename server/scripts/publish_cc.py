"""Copy a server library's songs from a local database to the live one, uploading their clips to R2.

From server/:  python -m scripts.publish_cc sqlite:///C:/path/to/stemguess.db [--prefix hits:]

The target is DATABASE_URL from server/.env (the live database). Only songs whose source starts with
the prefix (default "cc:") are copied, so nothing else on the local machine is ever uploaded. Songs
already in the target are skipped, unless their clips changed (e.g. after reseparate_hits): then the
new clips are uploaded and replace the old ones.
"""

import mimetypes
import sys

import boto3
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app import config
from app.db import SessionLocal, init_db
from app.models import Song, Stem
from scripts.progress import Progress

PUBLISHABLE = ("cc:", "hits:")


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    prefix = sys.argv[sys.argv.index("--prefix") + 1] if "--prefix" in sys.argv else "cc:"
    if prefix in args:
        args.remove(prefix)
    if not args:
        sys.exit("Usage: python -m scripts.publish_cc <source database URL> [--prefix hits:]")
    if prefix not in PUBLISHABLE:
        sys.exit(f"--prefix must be one of {', '.join(PUBLISHABLE)}")
    source_url = args[0]
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

    def live_path(path: str) -> str:
        return path if path.startswith("http") else f"{config.R2_PUBLIC_URL}/{path}"

    init_db()
    with SessionLocal() as live:
        existing = {s.source_file: {st.path for st in s.stems}
                    for s in live.scalars(select(Song).where(Song.source_file.startswith(prefix)))}
    with Session(create_engine(source_url)) as local:
        songs = local.scalars(select(Song).where(Song.source_file.startswith(prefix))).all()
        todo = [s for s in songs
                if existing.get(s.source_file) != {live_path(st.path) for st in s.stems}]
        progress = Progress(len(todo), "songs to publish")
        for song in todo:
            stems = []
            for stem in song.stems:
                if not stem.path.startswith("http"):
                    file = config.MEDIA_DIR / stem.path
                    content_type = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
                    s3.upload_file(str(file), config.R2_BUCKET, stem.path, ExtraArgs={
                        "ContentType": content_type, "CacheControl": "public, max-age=31536000, immutable"})
                stems.append(Stem(name=stem.name, path=live_path(stem.path)))
            with SessionLocal() as live:
                old = live.scalars(select(Song).where(Song.source_file == song.source_file)).first()
                if old:
                    for path in {st.path for st in old.stems} - {st.path for st in stems}:
                        if path.startswith(f"{config.R2_PUBLIC_URL}/"):
                            s3.delete_object(Bucket=config.R2_BUCKET,
                                             Key=path.removeprefix(f"{config.R2_PUBLIC_URL}/"))
                    old.stems = stems
                    old.duration = song.duration
                else:
                    live.add(Song(title=song.title, artist=song.artist, aliases=list(song.aliases or []),
                                  source_file=song.source_file, duration=song.duration, credit=song.credit,
                                  stems=stems))
                live.commit()
            progress.step(f"{'updated' if old else 'published'}: {song.title} - {song.artist}")
    print(f"done, {len(todo)} songs published or updated ({len(songs) - len(todo)} already live)")


if __name__ == "__main__":
    main()
