"""Add every song in a music folder to hits.csv, ready for import_hits.

From server/:  python -m scripts.add_folder_hits "D:/music" [--dry-run]
               python -m scripts.add_folder_hits --tidy   (fill in missing artists of listed songs)

Titles and artists come from the files' tags or names (see import_library). Skipped: files already
in hits.csv or hits_rejected.csv, songs already listed under the same title and artist, files
shorter than a minute or longer than ten (mixes, podcasts), and names with no usable title. Rows are
added without a YouTube link; edit titles and artists in hits.csv before importing if needed.
"""

import csv
import re
import sys
from collections import Counter
from pathlib import Path

from scripts.import_hits import HITS, read_hits
from scripts.import_library import AUDIO_EXTS, MAX_SECONDS, MIN_SECONDS, probe, song_name, usable
from scripts.progress import Progress
from scripts.remove_hits import REJECTED


# Left over from file names: "Big Sean Beware Explicit", "... In A World Like This Audio".
TRAILING_JUNK = re.compile(r"(?:\s+(?:audio|explicit|clean|lyrics?|hd|hq))+$", re.I)


def path_key(path: str) -> str:
    return path.replace("\\", "/").casefold()


def song_key(artist: str, title: str) -> str:
    plain = lambda s: re.sub(r"\W+", "", s.casefold())
    return f"{plain(artist)}|{plain(title)}"


def tidy(rows: list[dict], known: list[dict]) -> int:
    """Finds the artist of rows that have none: "Artist - Title", or a title starting with an artist
    that other songs already credit ("Akon Call Da Police"). Returns how many rows it fixed."""
    names = Counter(r["artist"] for r in known if len(r["artist"]) >= 3)
    artists = sorted(names, key=len, reverse=True)
    fixed = 0
    for row in rows:
        if row["artist"] or row.get("youtube"):
            continue
        title = row["title"]
        if " - " in title:
            artist, title = (part.strip() for part in title.split(" - ", 1))
        else:
            artist = next((a for a in artists if title.casefold().startswith(a.casefold() + " ")), "")
            title = title[len(artist):].strip() if artist else title
        title = TRAILING_JUNK.sub("", title).strip()
        if artist and usable(title):
            row["artist"], row["title"] = artist, title
            fixed += 1
    return fixed


def write_hits(rows: list[dict], fields: list[str]) -> None:
    rows = sorted(rows, key=lambda r: (r["artist"].casefold(), r["title"].casefold()))
    with HITS.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    hits = read_hits()
    if "--tidy" in sys.argv:
        print(f"{tidy(hits, hits)} songs given an artist")
        write_hits(hits, list(hits[0].keys()))
        return
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit('Usage: python -m scripts.add_folder_hits "D:/music" [--dry-run] | --tidy')
    folder = Path(args[0])
    known = hits + (read_hits(REJECTED) if REJECTED.exists() else [])
    files_seen = {path_key(h["file"]) for h in known if h.get("file")}
    songs_seen = {song_key(h["artist"], h["title"]) for h in known}
    titles_seen = {song_key("", h["title"]) for h in known}

    files = sorted(p for p in folder.rglob("*") if p.suffix.lower() in AUDIO_EXTS)
    added, skipped = [], {"listed": 0, "length": 0, "no title": 0, "duplicate": 0}
    progress = Progress(len(files), "audio files to check")
    for path in files:
        progress.done += 1
        if path_key(str(path)) in files_seen:
            skipped["listed"] += 1
            continue
        duration, tags = probe(path)
        if not duration or not MIN_SECONDS <= duration <= MAX_SECONDS:
            skipped["length"] += 1
            continue
        artist, title = song_name(path, tags)
        if not usable(title):
            skipped["no title"] += 1
            continue
        # Without an artist, a song only counts as new if no song has its title.
        key = song_key(artist, title)
        if key in songs_seen or (not artist and song_key("", title) in titles_seen):
            skipped["duplicate"] += 1
            continue
        songs_seen.add(key)
        titles_seen.add(song_key("", title))
        added.append({"title": title, "artist": artist, "youtube": "", "file": path.as_posix()})
        if progress.done % 100 == 0:
            progress.note(f"{len(added)} new so far")

    fixed = tidy(added, hits + added)
    print(f"{len(added)} new songs ({fixed} given an artist from their title); skipped {skipped}")
    if "--dry-run" in sys.argv:
        for row in added:
            print(f"  {row['artist'] or '?'} - {row['title']}    ({Path(row['file']).name})")
        return
    write_hits(hits + added, list(hits[0].keys()))
    print(f"hits.csv now lists {len(hits) + len(added)} songs")


if __name__ == "__main__":
    main()
