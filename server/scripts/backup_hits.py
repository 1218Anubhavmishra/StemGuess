"""Copy the "Preview of hits" stems out of server/media into a readable backup folder.

From server/:  python -m scripts.backup_hits ["D:/StemGuess backup/hits"]

Uses the database in DATABASE_URL (the local one, where the stem files are). Writes one folder per
song, "<artist> - <title>", holding its stems, plus songs.json with every song's title, artist,
YouTube link and stem files. Re-running only copies what's missing.
"""

import json
import re
import shutil
import sys
from pathlib import Path

from sqlalchemy import select

from app import config
from app.db import SessionLocal
from app.models import Song
from scripts.progress import Progress

DEFAULT_DEST = Path("D:/StemGuess backup/hits")


def folder_name(song: Song) -> str:
    name = f"{song.artist} - {song.title}" if song.artist else song.title
    return re.sub(r'[<>:"/\\|?*]+', "", name).strip(" .")[:120]


def main() -> None:
    dest = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DEST
    dest.mkdir(parents=True, exist_ok=True)
    manifest = []
    with SessionLocal() as db:
        songs = db.scalars(select(Song).where(Song.source_file.startswith("hits:")).order_by(Song.artist, Song.title)).all()
        progress = Progress(len(songs), "songs to back up")
        for song in songs:
            folder = dest / folder_name(song)
            folder.mkdir(exist_ok=True)
            files = []
            for stem in song.stems:
                src = config.MEDIA_DIR / stem.path
                if stem.path.startswith("http") or not src.exists():
                    progress.note(f"missing locally: {song.title} {stem.name}")
                    continue
                target = folder / src.name
                if not target.exists():
                    shutil.copy2(src, target)
                files.append(f"{folder.name}/{src.name}")
            manifest.append({"title": song.title, "artist": song.artist, "source": song.source_file,
                             "youtube": (song.credit or {}).get("url"), "stems": files})
            progress.step(folder.name)
    (dest / "songs.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{len(manifest)} songs backed up to {dest}")


if __name__ == "__main__":
    main()
