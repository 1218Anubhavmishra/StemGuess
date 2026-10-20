"""Which songs a game or practice draws from: the chosen artists, genres and languages.

Choices of one kind widen the pick (Pop or Dance); kinds narrow it (Pop or Dance, and in Hindi).
Nothing chosen of a kind means any. The client filters the same way (client/src/filters.ts).
"""

from .artists import artist_key, clean_choice, split_artists

KINDS = ("artists", "genres", "languages")
Filters = dict[str, list[str]]


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


def song_filter(filters: Filters | None):
    """A test for (artist, genre, language) that's true when the song matches every kind."""
    filters = filters or {}
    artists = {artist_key(a) for a in filters.get("artists", [])}
    genres = {artist_key(g) for g in filters.get("genres", [])}
    languages = {artist_key(lang) for lang in filters.get("languages", [])}

    def test(artist: str, genre: str | None, language: str | None) -> bool:
        return (
            (not artists or any(artist_key(n) in artists for n in split_artists(artist)))
            and (not genres or artist_key(genre or "") in genres)
            and (not languages or artist_key(language or "") in languages)
        )

    return test
