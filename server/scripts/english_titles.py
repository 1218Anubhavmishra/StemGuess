"""Song names in English letters only. english_titles.csv maps a title in another script (Japanese, Chinese...) to the
artist's official English title, or else its romaji: (artist, title, english).

From server/ with the local DATABASE_URL:  python -m scripts.english_titles
renames those songs in hits.csv and in the database (title and credit). publish_cc then renames them live.
Songs added later get their English name when they're added (env/scripts/more_songs_add.py); a title in another
script with no English name here isn't added until it has one.
"""
import csv
import re
import sys

from scripts.import_hits import HITS, credit_of, read_hits, source_of

NAMES = HITS.with_name("english_titles.csv")
# Latin letters with accents, punctuation, symbols such as ° and ～: everything else is another script
OTHER_SCRIPT = re.compile(r"[^\x00-ɏ -⁯℀-⅏～\s]")


def is_english(text: str) -> bool:
    return not OTHER_SCRIPT.search(text)


def load() -> dict[tuple[str, str], str]:
    with NAMES.open(encoding="utf-8-sig", newline="") as f:
        return {(r["artist"], r["title"]): r["english"] for r in csv.DictReader(f)}


def english(artist: str, title: str, names: dict | None = None) -> str | None:
    """The title in English letters, or None when it's in another script and has no English name yet."""
    names = load() if names is None else names
    if (artist, title) in names:
        return names[(artist, title)]
    return title if is_english(title) else None


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import Song

    names = load()
    rows = read_hits()
    fields = list(rows[0].keys())
    renamed, missing = {}, []
    for row in rows:
        new = english(row["artist"], row["title"], names)
        if new is None:
            missing.append(f"{row['artist']} - {row['title']}")
        elif new != row["title"]:
            row["title"] = new
            renamed[source_of(row)] = row
    with HITS.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    with SessionLocal() as db:
        songs = db.scalars(select(Song).where(Song.source_file.in_(renamed))).all()
        for song in songs:
            song.title, song.credit = renamed[song.source_file]["title"], credit_of(renamed[song.source_file])
        db.commit()
    print(f"{len(renamed)} songs renamed in hits.csv, {len(songs)} in the database")
    if missing:
        print(f"{len(missing)} titles still need an English name in {NAMES.name}:", *missing, sep="\n  ")


if __name__ == "__main__":
    main()
