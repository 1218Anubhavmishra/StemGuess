"""Artists of a song, for choosing which artists' songs a game or practice uses.

A song's artist field can credit several people ("Dr. Dre ft. Eminem", "Skylar Grey, Polo G &
Eminem"); each of them counts as an artist of the song. The client splits the same way
(client/src/artists.ts), so keep the two in step.
"""

import re
from collections import Counter

SEPARATORS = re.compile(r"\s*(?:,|&|;|/|\+|\bx\b|\bvs\.?(?=\s)|\bft\b\.?|\bfeat\b\.?|\bfeaturing\b)\s*", re.I)
# Credits that aren't a person: "Eminem & friends".
NOT_ARTISTS = {"friends", "others", "various", "various artists", "unknown", "unknown artist"}
MAX_CHOSEN = 100


def split_artists(text: str) -> list[str]:
    names = (" ".join(part.split()) for part in SEPARATORS.split(text or ""))
    return [n for n in names if n and n.casefold() not in NOT_ARTISTS]


def artist_key(name: str) -> str:
    return " ".join(name.split()).casefold()


def matches(artist_text: str, chosen: set[str]) -> bool:
    """True when no artists are chosen, or the song credits one of them (chosen holds artist_key()s)."""
    return not chosen or any(artist_key(n) in chosen for n in split_artists(artist_text))


def count_artists(artist_texts: list[str]) -> list[dict]:
    """[{"name", "songs"}] for every artist, most songs first; a name is shown in its commonest spelling."""
    counts: Counter[str] = Counter()
    spellings: dict[str, Counter[str]] = {}
    for text in artist_texts:
        for name in {artist_key(n): n for n in split_artists(text)}.values():
            counts[artist_key(name)] += 1
            spellings.setdefault(artist_key(name), Counter())[name] += 1
    rows = [{"name": spellings[k].most_common(1)[0][0], "songs": n} for k, n in counts.items()]
    return sorted(rows, key=lambda r: (-r["songs"], r["name"].casefold()))


def clean_choice(value: object) -> list[str] | None:
    """The chosen artists from a client, or None if malformed."""
    if not isinstance(value, list) or len(value) > MAX_CHOSEN:
        return None
    names = []
    for item in value:
        if not isinstance(item, str):
            return None
        name = " ".join(item.split())[:150]
        if name and artist_key(name) not in {artist_key(n) for n in names}:
            names.append(name)
    return names
