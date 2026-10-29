"""Fill the genre column of hits.csv from Apple's iTunes Search API (song metadata only; no audio).

From server/:  python -m scripts.hits_genres

Each song is looked up once; answers are kept in hits_itunes.json, so a stopped run resumes where it
left off. Apple's detailed genres are grouped into the broad ones in GENRES. Songs Apple doesn't know
take their artist's most common genre. Genres already in hits.csv are kept, so edit them there, then
publish with import_hits --sync-only. hits.csv is read again just before writing, so edits made
while this runs are kept.
"""

import csv
import json
import re
import sys
import time
from collections import Counter

import httpx

from app.artists import artist_key, split_artists
from app.filters import INDIAN_LANGUAGES, split_languages
from scripts.import_hits import HITS, read_hits, source_of
from scripts.progress import Progress

CACHE = HITS.with_name("hits_itunes.json")
SEARCH = "https://itunes.apple.com/search"
# Apple allows about 20 searches a minute.
PAUSE = 3.1

# Broad genre -> Apple genres in it. Unlisted Apple genres become "Other".
GENRES = {
    "Pop": ["Pop", "Teen Pop", "K-Pop", "J-Pop", "Pop Latino", "Pop/Rock", "Adult Contemporary", "Singer/Songwriter",
            "Soft Rock", "Vocal", "Easy Listening", "Holiday", "Christmas"],
    "Hip-Hop/Rap": ["Hip-Hop/Rap", "Hip-Hop", "Rap", "Hip Hop", "Gangsta Rap", "Hardcore Rap", "Underground Rap",
                    "West Coast Rap", "East Coast Rap", "Dirty South", "Alternative Rap", "UK Hip-Hop", "Old School Rap",
                    "Latin Rap", "Grime", "Drill", "Trap"],
    "Dance/Electronic": ["Dance", "Electronic", "Electronica", "House", "Techno", "Trance", "Dubstep", "Hardstyle",
                         "Hardcore", "Drum & Bass", "Breakbeat", "Garage", "Jungle/Drum'n'bass", "Club/Dance", "Downtempo",
                         "Ambient", "Electro", "Big Beat", "Bass"],
    "Rock": ["Rock", "Alternative", "Hard Rock", "Metal", "Heavy Metal", "Punk", "Indie Rock", "Indie Pop", "Alt-Rock",
             "College Rock", "Goth Rock", "Grunge", "Prog-Rock/Art Rock", "Rock & Roll", "Arena Rock", "Psychedelic",
             "Pop Punk", "American Trad Rock", "New Wave", "Death Metal/Black Metal", "Hair Metal"],
    "R&B/Soul": ["R&B/Soul", "R&B", "Soul", "Contemporary R&B", "Neo-Soul", "Funk", "Disco", "Motown", "Urban"],
    "Indian": ["Bollywood", "Indian Pop", "Indian", "Punjabi", "Punjabi Pop", "Rajasthani", "Tamil", "Telugu", "Malayalam",
               "Kannada", "Bengali", "Marathi", "Gujarati", "Bhojpuri", "Haryanvi", "Devotional & Spiritual",
               "Indian Classical", "Regional Indian", "Ghazals", "Sufi", "Indian Folk", "Carnatic Classical",
               "Hindustani Classical", "Urdu"],
    "Latin": ["Latin", "Latino", "Urbano latino", "Latin Urban", "Reggaeton", "Salsa y Tropical", "Música Mexicana",
              "Regional Mexicano", "Latin Pop", "Tropical", "Bachata", "Latin Alternative & Rock", "Flamenco"],
    "Country": ["Country", "Contemporary Country", "Americana", "Bluegrass", "Honky Tonk", "Folk", "Country Pop"],
    "Reggae/Afro": ["Reggae", "Roots Reggae", "Dancehall", "Afrobeats", "Afro-Pop", "African", "Afro House", "Ska"],
    "Jazz/Classical": ["Jazz", "Vocal Jazz", "Contemporary Jazz", "Smooth Jazz", "Big Band", "Blues", "Classical",
                       "Orchestral", "Opera", "Chamber Music"],
    "Soundtrack": ["Soundtrack", "Anime", "Video Game", "Original Score", "TV Soundtrack", "Musicals",
                   "Children's Music", "Disney"],
}
BROAD = {apple.casefold(): broad for broad, apples in GENRES.items() for apple in apples}


def broad_genre(apple: str) -> str:
    return BROAD.get(apple.casefold(), "Other") if apple else ""


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.casefold()).strip()


def same_artist(ours: str, theirs: str) -> bool:
    """True when any artist credited on our row appears in Apple's artist name (or the other way round)."""
    theirs = norm(theirs)
    return any(n and (n in theirs or theirs in n) for n in (norm(a) for a in split_artists(ours) or [ours]))


def lookup(client: httpx.Client, hit: dict) -> dict:
    """Apple's genre for a song, or {} when Apple has no song by that artist under that title."""
    params = {"term": f"{hit['title']} {hit['artist']}".strip(), "entity": "song", "media": "music", "limit": 10}
    for attempt in range(5):
        try:
            res = client.get(SEARCH, params=params)
        except httpx.TransportError:
            time.sleep(30)
            continue
        if res.status_code in (403, 429, 503):
            time.sleep(60 * (attempt + 1))
            continue
        res.raise_for_status()
        for r in res.json().get("results", []):
            if same_artist(hit["artist"], r.get("artistName", "")):
                return {"genre": r.get("primaryGenreName", ""), "track": r.get("trackName", ""),
                        "artist": r.get("artistName", "")}
        return {}
    raise RuntimeError("Apple kept refusing searches; run again later to resume")


def names_of(hit: dict) -> list[str]:
    return [artist_key(n) for n in split_artists(hit["artist"]) or [hit["artist"]]]


def fill(cache: dict) -> None:
    hits = read_hits()
    fields = list(hits[0].keys())
    for col in ("genre", "language"):
        if col not in fields:
            fields.insert(fields.index("artist") + 1 + (col == "language"), col)
    by_artist: dict[str, Counter] = {}
    for hit in hits:
        genre = broad_genre(cache.get(source_of(hit), {}).get("genre", ""))
        # A film's soundtrack album says nothing about a song's style.
        if genre and genre != "Soundtrack":
            for name in names_of(hit):
                by_artist.setdefault(name, Counter())[genre] += 1
    filled = 0
    for hit in hits:
        if hit.get("genre"):
            continue
        genre = broad_genre(cache.get(source_of(hit), {}).get("genre", ""))
        if not genre or genre == "Soundtrack":
            votes = sum((by_artist.get(n, Counter()) for n in names_of(hit)), Counter())
            genre = votes.most_common(1)[0][0] if votes else genre
        # Apple files some Indian and Pakistani songs under "Worldwide" or not at all.
        if genre in ("", "Other") and INDIAN_LANGUAGES & set(split_languages(hit.get("language"))):
            genre = "Indian"
        hit["genre"] = genre
        filled += bool(genre)
    with HITS.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, restval="")
        writer.writeheader()
        writer.writerows(hits)
    print(f"{filled} genres filled; {sum(not h['genre'] for h in hits)} songs still without a genre")
    print(Counter(h["genre"] or "(none)" for h in hits).most_common())


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    todo = [h for h in read_hits() if source_of(h) not in cache and not h.get("genre")]
    progress = Progress(len(todo), "songs to look up")
    with httpx.Client(timeout=20) as client:
        for hit in todo:
            found = lookup(client, hit)
            cache[source_of(hit)] = found
            CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=0), encoding="utf-8")
            progress.step(f"{found.get('genre') or 'NOT FOUND'}: {hit['title']} - {hit['artist']}")
            time.sleep(PAUSE)
    fill(cache)


if __name__ == "__main__":
    main()
