"""Make "Preview of hits" clips that keep non-lexical vocals and quieten the words.

From server/:  python -m scripts.vocables_hits [--limit N] [--model MODEL] [--new] [--redo-leaks]
                                               [--redo TITLE ...] [--redo-gaps]

By default the songs already in the database that aren't done are made again. --new adds the songs in
hits.csv that aren't in the database yet (straight from their audio file, without import_hits).
--redo-leaks makes again the songs whose vocals leaked (a leak of LEAK_LIMIT or more) with a model
smaller than MODEL, except those listed in hits_leaks_kept.csv (title, artist, youtube: songs whose
vocals belong to the music, like a soundtrack's choir); --new and --redo-leaks can be combined, and then
only those songs are made.
MODEL is the separation model (see separate_vocables.py): htdemucs (default, fastest), htdemucs_ft or
bs_roformer. So new songs go through htdemucs first, then --model htdemucs_ft --redo-leaks redoes the few that need it.
--redo makes the named songs again even if they are done (it can be repeated; "TITLE - ARTIST" picks one of
several songs sharing a title). --redo-gaps makes again
the songs done before vocals Whisper can't make out were quietened, if Whisper left a long gap in them.

Each song's clip (the same loudest CLIP_SECONDS as import_hits) is split by separate_vocables.py in
the Demucs environment (DEMUCS_PYTHON): the instruments and non-lexical vocals ("ooh", "yeah") stay,
sung words and vocals Whisper can't make out are quietened. Hindi, Punjabi and Haryanvi songs also
lower the short bits of vocals Whisper can't place, as it misses more words there. Clips in WORDLESS keep
all their vocals, clips in UNCLEAR_HOOKS the vocals Whisper can't make out. The clip becomes a single "mix" stem in a new folder (clips are cached as
immutable); songs whose only stem is "mix" are done, so a stopped run resumes where it left off. What
Whisper heard is kept in hits_words.json. Publish with publish_cc --prefix hits: (it replaces changed clips).
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from sqlalchemy import select

from app import config
from app.db import SessionLocal
from app.models import Song
from scripts.import_hits import DEMUCS_PYTHON, DEMUCS_RATE, HITS, add_song, read_hits, source_of
from scripts.process_songs import FFMPEG, clip_start
from scripts.progress import Progress
from scripts.reseparate_hits import replace_stems

SEPARATE = Path(__file__).with_name("separate_vocables.py")
WORDS = HITS.with_name("hits_words.json")
LEAKS_KEPT = HITS.with_name("hits_leaks_kept.csv")
BATCH = 10
MODELS = ("htdemucs", "htdemucs_ft", "bs_roformer")  # as in separate_vocables.py, smallest first
LEAK_LIMIT = 0.25
LANGUAGES = {"English": "en", "Hindi": "hi", "Punjabi": "pa", "Haryanvi": "hi", "Spanish": "es",
             "Portuguese": "pt", "Korean": "ko", "Italian": "it", "Japanese": "ja"}
UNSURE_DB = {"hi": -14.0, "pa": -14.0}
# Clips whose vocals are all a wordless hook that Whisper mishears as words: kept at full level.
WORDLESS = {"buffalo soldier"}
# Clips where the vocals Whisper can't make out are a wordless hook ("oh-I-oh-I"): those stay at full level.
# Entries are a title, or "title - artist" where another hit shares the title.
UNCLEAR_HOOKS = {"shape of you", "only human - example", "innocent minds", "arcadia"}
RELISTEN_GAP = 1.0  # as in separate_vocables.py


def has_gap(heard: dict) -> bool:
    """Whether the words Whisper heard leave a stretch of RELISTEN_GAP or more uncovered."""
    reached = 0.0
    for w in sorted(heard["words"], key=lambda w: w["start"]):
        if w["start"] - reached >= RELISTEN_GAP:
            return True
        reached = max(reached, w["end"])
    return config.CLIP_SECONDS - reached >= RELISTEN_GAP


def job_for(hit: dict, clip: Path, out: Path) -> dict:
    languages = [LANGUAGES.get(lang.strip()) for lang in (hit.get("language") or "").split(",") if lang.strip()]
    languages = [lang for lang in languages if lang]
    language = languages[0] if len(languages) == 1 else None
    unsure = min((UNSURE_DB.get(lang, 0.0) for lang in languages), default=0.0)
    return {"clip": str(clip), "out": str(out), "title": hit["title"], "language": language, "unsure_db": unsure,
            "wordless": hit["title"].casefold() in WORDLESS,
            "unclear_hook": bool({hit["title"].casefold(), f"{hit['title']} - {hit['artist']}".casefold()} & UNCLEAR_HOOKS)}


def run_batch(batch: list[dict], words: dict, progress: Progress, model: str, in_db: set[str]) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        jobs = []
        for i, hit in enumerate(batch):
            src, clip = Path(hit["file"]), Path(tmp) / f"{i}.wav"
            try:
                subprocess.run([FFMPEG, "-y", "-v", "error", "-ss", f"{clip_start(src):.2f}", "-t",
                                str(config.CLIP_SECONDS), "-i", str(src), "-vn", "-ac", "2", "-ar", str(DEMUCS_RATE),
                                str(clip)], check=True)
                jobs.append({**job_for(hit, clip, Path(tmp) / f"{i}-out"), "hit": i})
            except subprocess.CalledProcessError as exc:
                progress.step(f"failed to cut {hit['title']}: {exc}")
        jobs_file = Path(tmp) / "jobs.json"
        jobs_file.write_text(json.dumps(jobs, ensure_ascii=False), encoding="utf-8")
        # separate_vocables.py prints "done <out>" or "failed <out>: <error>" as each clip finishes.
        with subprocess.Popen([DEMUCS_PYTHON, str(SEPARATE), str(jobs_file), "--model", model],
                              stdout=subprocess.PIPE, text=True, encoding="utf-8") as separator:
            for line in separator.stdout:
                status, _, rest = line.strip().partition(" ")
                job = next((j for j in jobs if rest == j["out"] or rest.startswith(j["out"] + ":")), None)
                if not job:
                    continue
                hit = batch[job["hit"]]
                if status != "done":
                    progress.step(f"failed: {hit['title']}: {rest.removeprefix(job['out'] + ':').strip()}")
                    continue
                try:
                    out = Path(job["out"])
                    heard = json.loads((out / "words.json").read_text(encoding="utf-8"))
                    (out / "words.json").unlink()
                    if source_of(hit) in in_db:
                        replace_stems(source_of(hit), out)
                    else:
                        add_song(hit, out)
                        in_db.add(source_of(hit))
                    words[source_of(hit)] = {"title": hit["title"], "artist": hit["artist"], **heard}
                    WORDS.write_text(json.dumps(words, ensure_ascii=False, indent=1), encoding="utf-8")
                    quiet = [w["word"] for w in heard["words"] if not w["vocable"]]
                    kept = [w["word"] for w in heard["words"] if w["vocable"]]
                    unheard = sum(e - s for s, e in heard.get("unheard", []))
                    leaked = "  LEAK, needs a bigger model" if heard["leak"] >= LEAK_LIMIT else ""
                    progress.step(f"{hit['title']} - {hit['artist']} [{heard['language']}, {heard['model']},"
                                  f" leak {heard['leak']:.0%}]: {len(quiet)} words"
                                  + (f" and {unheard:.1f} s unclear vocals" if unheard else "")
                                  + f" quietened, kept {' '.join(kept) or 'no vocables'}{leaked}")
                except Exception as exc:
                    progress.step(f"failed: {hit['title']}: {exc}")
        if separator.returncode:
            raise subprocess.CalledProcessError(separator.returncode, separator.args)


def main() -> None:
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 0
    model = sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else MODELS[0]
    if model not in MODELS:
        sys.exit(f"--model must be one of {', '.join(MODELS)}")
    titles = {sys.argv[i + 1].casefold() for i, arg in enumerate(sys.argv[:-1]) if arg == "--redo"}
    new, redo_leaks = "--new" in sys.argv, "--redo-leaks" in sys.argv
    if not FFMPEG:
        sys.exit("ffmpeg is needed to cut the clips.")
    words = json.loads(WORDS.read_text(encoding="utf-8")) if WORDS.exists() else {}
    redo = {source for source, heard in words.items() if "unheard" not in heard and has_gap(heard)} \
        if "--redo-gaps" in sys.argv else set()
    if redo_leaks:
        kept = {source_of(h) for h in read_hits(LEAKS_KEPT)} if LEAKS_KEPT.exists() else set()
        redo |= {source for source, heard in words.items() if heard.get("leak", 0) >= LEAK_LIMIT and source not in kept
                 and heard.get("model") in MODELS and MODELS.index(heard["model"]) < MODELS.index(model)}
    with SessionLocal() as db:
        in_db = set(db.scalars(select(Song.source_file).where(Song.source_file.startswith("hits:"))))
        songs = [s for s in db.scalars(select(Song).where(Song.source_file.startswith("hits:")))
                 if s.stems and not s.stems[0].path.startswith("http")]
        redo |= {s.source_file for s in songs if {s.title.casefold(), f"{s.title} - {s.artist}".casefold()} & titles}
        redo &= {s.source_file for s in songs}
        unfinished = set() if new or redo_leaks else \
            {s.source_file for s in songs if [st.name for st in s.stems] != ["mix"]}
    hits = [h for h in read_hits() if h.get("file") and Path(h["file"]).exists()]
    todo_sources = unfinished | redo | ({source_of(h) for h in hits} - in_db if new else set())
    todo = list({source_of(h): h for h in reversed(hits) if source_of(h) in todo_sources}.values())[::-1]
    # Redone songs first, so a short run with --limit includes them.
    todo.sort(key=lambda h: source_of(h) not in redo)
    print(f"{len(todo)} songs left in all ({len(redo & todo_sources)} to redo), separating with {model}")
    todo = todo[:limit] if limit else todo
    progress = Progress(len(todo), "songs this run")
    for start in range(0, len(todo), BATCH):
        run_batch(todo[start : start + BATCH], words, progress, model, in_db)


if __name__ == "__main__":
    main()
