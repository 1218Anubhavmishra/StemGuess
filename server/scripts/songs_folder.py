"""Play only the songs whose audio is in SONGS_DIR (yt-dlp downloads named "... [VIDEO_ID].mp3").

From server/:  python -m scripts.songs_folder [--dry-run]

1. Songs in hits.csv whose YouTube video is in SONGS_DIR but whose audio file is elsewhere are pointed at the
   SONGS_DIR copy (their clips are made again by full_mix_hits, which this lists them for).
2. Every song in the database (any library) whose audio isn't in SONGS_DIR is hidden, except hits by
   EXTRA_ARTISTS: it stays stored but games and the Song Library never use it. The others are shown again.
3. Files in SONGS_DIR that no hits.csv row knows are written to songs_folder_review.csv with what
   artists_by_genre_and_language_internet_songs.csv says about them, for checking before they're added.
"""

import csv
import json
import re
import sys
from pathlib import Path

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Song
from scripts.import_hits import HITS, read_hits, site_of, source_of, video_id
from scripts.full_mix_hits import DONE

SONGS_DIR = Path("D:/songs")
# Artists whose songs are played wherever their audio is (theirs is in D:/music), matched at the start of
# the artist ("Rustage ft. McGwire" counts).
EXTRA_ARTISTS = ("billie eilish", "rustage")
INTERNET_SONGS = Path(__file__).resolve().parents[2] / "artists_by_genre_and_language_internet_songs.csv"
REVIEW = HITS.with_name("songs_folder_review.csv")
VIDEO_ID = re.compile(r"\[([\w-]{11})\]\.[^.]+$")


def folder_files() -> dict[str, Path]:
    return {m.group(1): f for f in SONGS_DIR.iterdir() if f.is_file() and (m := VIDEO_ID.search(f.name))}


def youtube_id(hit: dict) -> str:
    return video_id(hit["youtube"]) if hit.get("youtube") and site_of(hit["youtube"]) == "YouTube" else ""


def write_hits(hits: list[dict]) -> None:
    with HITS.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(hits[0]))
        writer.writeheader()
        writer.writerows(hits)


def review_unknown(unknown: dict[str, Path]) -> int:
    with INTERNET_SONGS.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    out = []
    for vid, path in sorted(unknown.items(), key=lambda item: item[1].name.casefold()):
        for row in rows:
            for kind, link, title in (("song", "YouTube link", "YouTube video title"),
                                      ("instrumental", "Instrumental link", "Instrumental video title")):
                if row.get(link) and video_id(row[link]) == vid:
                    out.append({"file": path.name, "video_id": vid, "downloaded_as": kind, "title": row["Song"],
                                "artist": row["Artist"], "featured_artist": row["Featured"], "genre": row["Genre"],
                                "language": row["Language"], "video_title": row[title], "youtube": row[link]})
        if not any(r["video_id"] == vid for r in out):
            out.append({"file": path.name, "video_id": vid, "downloaded_as": "unknown"})
    with REVIEW.open("w", encoding="utf-8-sig", newline="") as f:
        fields = ["file", "video_id", "downloaded_as", "title", "artist", "featured_artist", "genre", "language",
                  "video_title", "youtube"]
        writer = csv.DictWriter(f, fieldnames=fields, restval="")
        writer.writeheader()
        writer.writerows(out)
    return len(out)


def main() -> None:
    dry = "--dry-run" in sys.argv
    files = folder_files()
    hits = read_hits()

    moved = []
    for hit in hits:
        vid = youtube_id(hit)
        if vid in files and Path(hit["file"]) != files[vid]:
            moved.append((source_of(hit), f"{hit['title']}: {hit['file']} -> {files[vid].name}"))
            hit["file"] = files[vid].as_posix()
    keep = {source_of(h) for h in hits if Path(h["file"]).parent == SONGS_DIR}
    print(f"{len(files)} files in {SONGS_DIR}; {len(keep)} hits.csv songs use them")
    for _, message in moved:
        print(f"  now from {SONGS_DIR}: {message}")

    with SessionLocal() as db:
        songs = list(db.scalars(select(Song)))
        keep |= {s.source_file for s in songs
                 if s.source_file.startswith("hits:") and s.artist.casefold().startswith(EXTRA_ARTISTS)}
        hide = [s for s in songs if s.source_file not in keep and not s.hidden]
        show = [s for s in songs if s.source_file in keep and s.hidden]
        print(f"hiding {len(hide)} songs, showing {len(show)} again; "
              f"{len(songs) - sum(s.source_file not in keep for s in songs)} songs will be playable")
        if not dry:
            for s in hide:
                s.hidden = True
            for s in show:
                s.hidden = False
            db.commit()

    unknown = {vid: path for vid, path in files.items() if vid not in {youtube_id(h) for h in hits}}
    if dry:
        print(f"{len(unknown)} files aren't in hits.csv (dry run: nothing written)")
        return
    if moved:
        write_hits(hits)
        # Their clips came from the old file, so full_mix_hits makes them again.
        if DONE.exists():
            done = set(json.loads(DONE.read_text(encoding="utf-8"))) - {source for source, _ in moved}
            DONE.write_text(json.dumps(sorted(done), indent=0), encoding="utf-8")
        print("updated hits.csv; run full_mix_hits to cut their clips from the new files")
    print(f"{len(unknown)} files aren't in hits.csv: {review_unknown(unknown)} rows in {REVIEW.name}")


if __name__ == "__main__":
    main()
