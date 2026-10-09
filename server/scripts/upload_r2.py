"""Upload locally stored stems to Cloudflare R2 and point the database at the public URLs.

1. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_URL in server/.env.
2. Use the same DATABASE_URL the live server uses (e.g. Render's *external* Postgres URL).
3. From server/:  python -m scripts.upload_r2

Stems that already have a URL are skipped, so it's safe to run after every batch of new songs.
Demo songs are left alone (the server regenerates them itself).
"""

import mimetypes
import sys

import boto3
from sqlalchemy import select

from app import config
from app.db import SessionLocal, init_db
from app.models import Stem


def main() -> None:
    required = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_URL")
    missing = [name for name in required if not getattr(config, name)]
    if missing:
        sys.exit(f"Set {', '.join(missing)} in server/.env first.")

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=config.R2_ACCESS_KEY_ID,
        aws_secret_access_key=config.R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )

    init_db()
    uploaded = 0
    with SessionLocal() as db:
        stems = db.scalars(select(Stem).where(Stem.path.not_like("http%"), Stem.path.not_like("demo/%"))).all()
        for stem in stems:
            local = config.MEDIA_DIR / stem.path
            if not local.exists():
                print(f"  missing file, skipped: {stem.path}")
                continue
            content_type = mimetypes.guess_type(local.name)[0] or "application/octet-stream"
            s3.upload_file(
                str(local),
                config.R2_BUCKET,
                stem.path,
                ExtraArgs={"ContentType": content_type, "CacheControl": "public, max-age=31536000, immutable"},
            )
            stem.path = f"{config.R2_PUBLIC_URL}/{stem.path}"
            db.commit()
            uploaded += 1
            print(f"uploaded: {stem.path}")
    print(f"done, {uploaded} stems uploaded")


if __name__ == "__main__":
    main()
