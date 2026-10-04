import re
import unicodedata
from difflib import SequenceMatcher

_BRACKETS = re.compile(r"[\(\[].*?[\)\]]")
_DASH_SUFFIX = re.compile(r"\s+-\s+.*$")  # "Song - Remastered 2011"
_PUNCT = re.compile(r"[^\w ]+")
_SPACES = re.compile(r"\s+")

CORRECT_THRESHOLD = 0.85
CLOSE_THRESHOLD = 0.7


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).casefold().replace("&", " and ")
    text = _BRACKETS.sub(" ", text)
    text = _DASH_SUFFIX.sub("", text)
    text = _PUNCT.sub(" ", text).replace("_", " ")
    text = _SPACES.sub(" ", text).strip()
    if text.startswith("the "):
        text = text[4:]
    return text


def similarity(guess: str, answers: list[str]) -> float:
    g = normalize(guess)
    if not g:
        return 0.0
    best = 0.0
    for answer in answers:
        a = normalize(answer)
        if not a:
            continue
        if g == a:
            return 1.0
        best = max(best, SequenceMatcher(None, g, a).ratio())
    return best
