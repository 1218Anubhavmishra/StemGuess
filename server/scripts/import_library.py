"""Turn a music folder into 15 s clips in songs_input/, ready for scripts.process_songs.

From server/:  python -m scripts.import_library "D:/music" --dry-run   (just list the titles it would use)
               python -m scripts.import_library "D:/music" --limit 50

Titles come from the file's tags, falling back to the file name, with download-site junk
removed ("(webmusic.in)", "(128k)", track numbers, ...). Each clip is the song's most energetic
CLIP_SECONDS, so Music.ai is only paid for that stretch. Review songs_input/_library.csv and
delete or rename any clip with a wrong title before running process_songs.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
from pathlib import Path

from app import config
from scripts.process_songs import FFMPEG, FFPROBE, clip_start

AUDIO_EXTS = {".mp3", ".m4a", ".flac", ".wav", ".ogg", ".aac"}
MIN_SECONDS = 60
MAX_SECONDS = 600

SITES = r"(?:com|in|net|org|info|co|cc|me|pk|fm|io|mobi|biz|ws|to)"
JUNK = [
    rf"\((?:www\.)?[\w-]+\.{SITES}[^)]*\)",                     # (webmusic.in), (PunjabiMob.Com)
    r"\[[^\]]*\]",                                              # [Official Video], [320kbps]
    rf"(?:-\s*)?(?:www\.)?[\w-]+(?:\.[\w-]+)*\.{SITES}\b",       # " - www.SongsLover.mobi"
    r"\(\s*R\s*\)",                                             # (R)
    r"\(\d+k(?:bps)?\)|\b\d{3}\s?kbps\b",                       # (128k), 320kbps
    r"#\w+",                                                    # hashtags
    r"\.?\bmp3\b(?:\s*\d+)?",                                   # "... mp3 21649", "Jump .mp3"
    r"\((?:official|lyrics?|audio|video|hd|hq|full song)[^)]*\)",
    r"\b(?:official (?:music )?video|lyrics? video|full song|audio song)\b",
]
TRACK_NUMBER = r"^\s*\d{1,3}\s*[-_.)]\s*"
# Parts of a title nobody would type as a guess.
TITLE_EXTRAS = [
    r"\((?:[^)]*\b(?:feat|ft|featuring|with|remix|mix|version|explicit|clean|cdq|demo|tags|edit|cut|cover|"
    r"live|acoustic|remaster(?:ed)?|bonus|extended|radio|instrumental|from|prod|slowed|reverb|video|"
    r"exclusive)\b[^)]*)\)",
    r"\s*\((?:feat|ft|featuring|prod|from|full)\b[^)]*$",       # tag cut off mid-bracket: "Beautiful (Feat"
    r"\s(?:feat\.?|ft\.?|featuring)\s.*$",
    r"\s\d{3,}$",
]


def probe(path: Path) -> tuple[float | None, dict[str, str]]:
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration:format_tags=title,artist", "-of", "json", str(path)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    try:
        fmt = json.loads(out.stdout).get("format", {})
    except json.JSONDecodeError:
        return None, {}
    tags = {k.lower(): v for k, v in (fmt.get("tags") or {}).items()}
    try:
        return float(fmt.get("duration")), tags
    except (TypeError, ValueError):
        return None, tags


def clean(text: str) -> str:
    # Tags saved as Windows-1252 often arrive with its curly quotes as C1 control characters.
    text = (text or "").translate({0x91: "'", 0x92: "'", 0x93: '"', 0x94: '"', 0x96: "-", 0x97: "-"})
    text = re.sub(r"[\x00-\x1f\x7f-\x9f]", "", text)
    for pattern in JUNK:
        text = re.sub(pattern, " ", text, flags=re.IGNORECASE)
    text = re.sub(TRACK_NUMBER, "", text)
    text = text.replace("_", " ")
    text = re.sub(r"(?<=\w)-(?=\w)", " ", text) if " " not in text.strip() else text
    text = re.sub(r"\(\s*\)", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" -_.,")


def clean_title(text: str) -> str:
    text = clean(text)
    for pattern in TITLE_EXTRAS:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip(" -_.,")
    if text.islower():
        text = " ".join(w[:1].upper() + w[1:] for w in text.split())
    return text


def usable(title: str) -> bool:
    return len(re.sub(r"[\W\d_]", "", title)) >= 2


def song_name(path: Path, tags: dict[str, str]) -> tuple[str, str]:
    title, artist = clean_title(tags.get("title", "")), clean(tags.get("artist", ""))
    if not usable(title):
        stem = clean(path.stem)
        if " - " in stem:
            artist_part, stem = (s.strip() for s in stem.split(" - ", 1))
            artist = artist or artist_part
        title = clean_title(stem)
    # Tags often hold several artists ("A, B & C"); the first is enough for display.
    artist = re.split(r"\s*(?:,|&|/|;| feat\.? | ft\.? )\s*", artist, maxsplit=1, flags=re.IGNORECASE)[0].strip()
    if not usable(artist):
        artist = ""
    return artist, title


def needs_review(artist: str, title: str) -> bool:
    """Heuristic: names that still look like a raw file name rather than a song title."""
    return (
        not artist
        or len(title.split()) > 6
        or bool(re.search(r"\d{4}|\bprod\b|\bby\b|\bsongs?\b|\bhit\b|\blatest\b", title, re.IGNORECASE))
    )


def safe_filename(text: str) -> str:
    return re.sub(r'[<>:"/\\|?*]', "", text).strip(" .")[:150]


def make_clip(src: Path, dest: Path) -> None:
    start = clip_start(src)
    subprocess.run(
        [FFMPEG, "-y", "-v", "error", "-ss", f"{start:.2f}", "-t", str(config.CLIP_SECONDS),
         "-i", str(src), "-vn", "-map_metadata", "-1", "-ac", "2", "-b:a", "192k", str(dest)],
        check=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--limit", type=int, default=0, help="stop after this many new clips")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if not FFMPEG or not FFPROBE:
        sys.exit("ffmpeg/ffprobe not found on PATH.")

    out_dir = config.SONGS_INPUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in args.source.rglob("*") if p.suffix.lower() in AUDIO_EXTS)
    seen: set[str] = set()
    rows, made, skipped = [], 0, {"length": 0, "duplicate": 0, "no title": 0}

    for path in files:
        duration, tags = probe(path)
        if not duration or not MIN_SECONDS <= duration <= MAX_SECONDS:
            skipped["length"] += 1
            continue
        artist, title = song_name(path, tags)
        if not usable(title):
            skipped["no title"] += 1
            continue
        key = re.sub(r"\W+", "", title.lower())
        if key in seen:
            skipped["duplicate"] += 1
            continue
        seen.add(key)

        name = safe_filename(f"{artist} - {title}" if artist else title)
        rows.append({
            "review": "check" if needs_review(artist, title) else "",
            "file": f"{name}.mp3",
            "artist": artist,
            "title": title,
            "source": str(path),
        })
        dest = out_dir / f"{name}.mp3"
        if args.dry_run or dest.exists():
            continue
        try:
            make_clip(path, dest)
            made += 1
            print(f"clip: {dest.name}")
        except subprocess.CalledProcessError as exc:
            print(f"  failed: {path.name}: {exc}")
        if args.limit and made >= args.limit:
            break

    with (out_dir / "_library.csv").open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["review", "file", "artist", "title", "source"])
        writer.writeheader()
        writer.writerows(sorted(rows, key=lambda r: (not r["review"], r["file"].lower())))
    flagged = sum(bool(r["review"]) for r in rows)
    print(f"{len(rows)} songs listed in {out_dir / '_library.csv'} ({flagged} marked 'check'), "
          f"{made} new clips; skipped {skipped}")


if __name__ == "__main__":
    main()
