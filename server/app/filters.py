"""Which songs a game or practice draws from: the chosen artists, genres and languages, and a search.

A song can have several of each: "Indian, Hip-Hop/Rap", "Hindi, English", "MC SQUARE, Paradox".
Choices of one kind widen the pick (Pop or Dance); kinds narrow it (Pop or Dance, and in Hindi).
Nothing chosen of a kind means any. A search keeps songs whose title, artist, genre or language
contains it. The client filters the same way (client/src/filters.ts).
"""

from .artists import artist_key, clean_choice, split_artists

KINDS = ("artists", "genres", "languages")
Filters = dict[str, list[str]]
MAX_SEARCH = 100
# Songs in these languages are also tagged Indian, whatever else their genre is.
INDIAN_LANGUAGES = {"Hindi", "Punjabi", "Haryanvi", "Bhojpuri", "Rajasthani", "Bengali", "Marathi", "Gujarati",
                    "Tamil", "Telugu", "Kannada", "Malayalam"}
INDIAN = "Indian"


def no_filters() -> Filters:
    return {kind: [] for kind in KINDS}


def clean_filters(data: dict) -> Filters | None:
    """The kinds a client sent ({"genres": [...]}, ...), cleaned; None if any is malformed."""
    out = {}
    for kind in KINDS:
        if kind in data and data[kind] is not None:
            chosen = clean_choice(data[kind])
            if chosen is None:
                return None
            out[kind] = chosen
    return out


def clean_search(value: object) -> str | None:
    """A client's search text, tidied; None if malformed."""
    if not isinstance(value, str):
        return None
    return " ".join(value.split())[:MAX_SEARCH]


def search_test(search: str | None):
    """A test for a song's (title, artist, genre, language) that's true when any contains the search."""
    needle = " ".join((search or "").split()).casefold()

    def test(*fields: str | None) -> bool:
        return not needle or any(needle in (f or "").casefold() for f in fields)

    return test


def split_languages(text: str | None) -> list[str]:
    """A song's languages: "Hindi, English" is both."""
    return [part.strip() for part in (text or "").split(",") if part.strip()]


def split_genres(text: str | None) -> list[str]:
    """A song's genres: "Indian, Hip-Hop/Rap" is both (a slash is part of a genre's name)."""
    return split_languages(text)


def tagged_genres(genre: str | None, language: str | None) -> str | None:
    """A song's genres plus those its languages imply: a Hindi rap song is "Indian, Hip-Hop/Rap"."""
    genres = split_genres(genre)
    if {artist_key(lang) for lang in INDIAN_LANGUAGES} & {artist_key(lang) for lang in split_languages(language)}:
        genres.insert(0, INDIAN)
    unique = {}
    for g in genres:
        unique.setdefault(artist_key(g), g)
    return ", ".join(unique.values()) or None


def song_filter(filters: Filters | None):
    """A test for (artist, genre, language) that's true when the song matches every kind."""
    filters = filters or {}
    artists = {artist_key(a) for a in filters.get("artists", [])}
    genres = {artist_key(g) for g in filters.get("genres", [])}
    languages = {artist_key(lang) for lang in filters.get("languages", [])}

    def test(artist: str, genre: str | None, language: str | None) -> bool:
        return (
            (not artists or any(artist_key(n) in artists for n in split_artists(artist)))
            and (not genres or any(artist_key(g) in genres for g in split_genres(genre)))
            and (not languages or any(artist_key(lang) in languages for lang in split_languages(language)))
        )

    return test
