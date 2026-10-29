"""Split short WAV clips into vocals and instrumental, keeping non-lexical vocals ("ooh", "yeah") and quietening the words.

Runs in the Demucs environment (needs PyTorch, Demucs, audio-separator and faster-whisper):
    python separate_vocables.py <jobs.json> [--model MODEL]
where jobs.json is a list of {"clip": <wav path>, "out": <output dir>, "title": <song title>,
"language": <Whisper language code or null>, "unsure_db": <level of vocals that aren't recognised>,
"wordless": <optional, true if the clip's vocals are all a wordless hook Whisper mishears as words>,
"unclear_hook": <optional, true if the vocals Whisper can't make out are a wordless hook, kept at full level>}.
MODEL is one of MODELS, from fastest to best: htdemucs (default), htdemucs_ft (about 4x slower) or
bs_roformer (about 15x slower). Each output dir gets mix.wav (the instrumental plus the processed vocals)
and words.json (what Whisper heard, which words were quietened, the model and the leak: the largest share
of vocals hdemucs_mmi still finds in any second of the instrumental, so songs whose vocals leaked can be
made again with a better model). Prints "done <out>" or "failed <out>: <error>" per clip.

Whisper finds the sung words (told the song's language, but not the title: as a hotword it made Whisper
stop after hearing the title once). Words are WORD_DB quieter; vocables stay at full level, except ones that are words of the title (a sung
"na na na" gives away "Right Now (Na Na Na)"). Stretches of vocals Whisper can't make out even on a second
listen are quietened like words; other vocals it didn't place (short bits between words) sit at unsure_db:
0 for English, lower for languages where Whisper misses more words. Level changes ramp (RAMP_DOWN/RAMP_UP).
"""

import json
import re
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model
from faster_whisper import WhisperModel

MODELS = ("htdemucs", "htdemucs_ft", "bs_roformer")
LEAK_JUDGE = "hdemucs_mmi"
ROFORMER = "model_bs_roformer_ep_317_sdr_12.9755.ckpt"
WHISPER = "large-v3-turbo"
RATE = 44100
WORD_DB = -28.0
PAD_BEFORE, PAD_AFTER = 0.05, 0.25  # around each word; the tail covers its echo
# Like a radio ducker: down quickly, finished before the word starts; back up slowly after it, so echo
# tails fade in instead of jumping back.
RAMP_DOWN, RAMP_UP = 0.15, 0.5
MERGE_GAP = 0.35  # words closer than this stay quiet in between, so the vocals don't pump
FRAME = 0.01
# Whisper sometimes stops early or skips a line, so gaps this long are listened to again on their own,
# with some context either side; gaps with vocals quieter than SILENT_DB are skipped (Whisper invents
# words in silence). Vocals it still can't make out (a chant in another language, mumbling) are
# quietened like words: they may well be words.
RELISTEN_GAP, RELISTEN_CONTEXT, SILENT_DB = 1.0, 0.5, -45.0
INDIAN = {"hi", "pa", "ur", "bn", "mr", "gu", "ta", "te"}
# Sounds without meaning. In Indian languages short syllables such as "ho", "na", "aa", "re" are real
# words, so only these unambiguous ones count, plus runs of 3+ identical short syllables ("na na na").
STRICT = {"oh", "ohh", "ooh", "oooh", "ah", "ahh", "aah", "mm", "mmm", "hmm", "hm", "yeah", "hey", "woah", "whoa",
          "uh", "ooh-ooh", "ओह", "आह", "ऊ", "ऊऊ", "हम्म", "अह"}
BROAD = re.compile(r"^(o+h*|a+h*|u+h*|e+h*|m+|h+m+|oo+h*|w?h?o+a+h*|ye+a*h*|ya+h*|he+y+|a+y+|e+y+|ho+|ha+|hu+h*|"
                   r"la+|na+|da+|ba+|doo+|du+|di+|woo+|uh+|mhm|uh-?huh|yo+|[wy]?(a+i+|o+[iy]+))$")
_DEV, _LAT = "कखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसहळ", "kkggnccjjnttddnttddnppbbm-rlvssshl"
DEVANAGARI_CONSONANTS = dict(zip(_DEV, _LAT, strict=True))
LATIN_DIGRAPHS = re.compile(r"(kh|gh|ch|jh|th|dh|ph|bh|sh)")


def tokens(text: str) -> list[str]:
    return [t for t in re.split(r"[\s\-–,.!?…'\"()]+", text.casefold()) if t]


def squash(token: str) -> str:
    """Drop repeated letters, so sung stretches match the written word ("yeaaah" -> "yeah", "ooh" -> "oh")."""
    return re.sub(r"(.)\1+", r"\1", token)


def is_devanagari(token: str) -> bool:
    return bool(re.search(r"[\u0900-\u097f]", token))


def skeleton(token: str) -> str:
    """Consonant sounds only, so a word can be compared across scripts ("ओह" ~ "oh", "हर" ~ "har")."""
    if is_devanagari(token):
        out = "".join(DEVANAGARI_CONSONANTS.get(ch, "n" if ch in "ंँ" else "h" if ch == "ः" else "") for ch in token)
    else:
        latin = LATIN_DIGRAPHS.sub(lambda m: m.group(0)[0], token).replace("w", "v").replace("z", "j").replace("q", "k")
        out = re.sub(r"[aeiouy\W\d_]", "", latin)
    return squash(out.replace("-", ""))


def in_title(token: str, title_tokens: list[str]) -> bool:
    for t in title_tokens:
        if is_devanagari(t) == is_devanagari(token):
            if squash(t) == squash(token):
                return True
        elif skeleton(t) and skeleton(t) == skeleton(token):
            return True
    return False


def classify(words: list[dict], language: str, title: str = "") -> list[bool]:
    """True for each word that is a vocable."""
    title_tokens = tokens(title)
    toks = [tokens(w["word"]) for w in words]
    out = []
    for i, ts in enumerate(toks):
        if not ts:
            out.append(True)
        elif any(in_title(t, title_tokens) for t in ts):
            out.append(False)
        elif language in INDIAN:
            voc = all(t in STRICT for t in ts)
            if not voc and len(ts[0]) <= 3:
                # Back to back, so a rhyme ending every line ("bana de, saja de, pina de") stays a word.
                voc = any(all(toks[j] == ts for j in range(s, s + 3))
                          for s in range(max(0, i - 2), min(i, len(toks) - 3) + 1))
            out.append(voc)
        else:
            # Single letters ("a", "o", "i") are words.
            out.append(all(t in STRICT or (len(t) >= 2 and BROAD.match(t)) for t in ts))
    return out


def merge(spans: list[tuple[float, float]], gap: float) -> list[list[float]]:
    out: list[list[float]] = []
    for s, e in sorted(spans):
        if out and s - out[-1][1] <= gap:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return out


def vocal_gain(n: int, words: list[dict], vocable: list[bool], unsure_db: float,
               unheard: list[list[float]] = ()) -> np.ndarray:
    """Gain per sample for the vocals: full level, unsure_db or WORD_DB, with ramps that never raise a word.

    unheard: stretches with vocals Whisper couldn't make out, quietened like words.
    """
    frames = int(np.ceil(n / RATE / FRAME)) + 1
    target = np.full(frames, float(unsure_db))

    def span(s: float, e: float, lead: float = 0.0) -> slice:
        return slice(max(0, int((s - PAD_BEFORE - lead) / FRAME)), min(frames, int(np.ceil((e + PAD_AFTER) / FRAME))))

    for s, e in unheard:
        target[span(s, e)] = WORD_DB
    for w, voc in zip(words, vocable):
        if voc:
            # Start rising early, so a vocable is at full level when it starts.
            target[span(w["start"], w["end"], RAMP_UP)] = 0.0
    lexical = [(w["start"], w["end"]) for w, voc in zip(words, vocable) if not voc]
    for s, e in merge(lexical, MERGE_GAP + PAD_BEFORE + PAD_AFTER):
        target[span(s, e)] = WORD_DB
    # Limit how fast the level may rise (forwards) and fall (backwards, so falls end before the word).
    # Both passes only ever lower the level, so it never goes above the target.
    db = target.copy()
    up, down = -WORD_DB / RAMP_UP * FRAME, -WORD_DB / RAMP_DOWN * FRAME
    for i in range(1, frames):
        db[i] = min(db[i], db[i - 1] + up)
    for i in range(frames - 2, -1, -1):
        db[i] = min(db[i], db[i + 1] + down)
    return (10 ** (np.interp(np.arange(n) / RATE, np.arange(frames) * FRAME, db) / 20)).astype(np.float32)


def gaps(words: list[dict], start: float, end: float) -> list[tuple[float, float]]:
    """Stretches of at least RELISTEN_GAP between start and end that no word covers."""
    edges = [start] + [t for w in sorted(words, key=lambda w: w["start"]) for t in (w["start"], w["end"])] + [end]
    out, reached = [], start
    for s, e in zip(edges[1:-1:2], edges[2:-1:2]):
        if s - reached >= RELISTEN_GAP:
            out.append((reached, s))
        reached = max(reached, e)
    if end - reached >= RELISTEN_GAP:
        out.append((reached, end))
    return out


def loud(audio: np.ndarray, a: float, b: float) -> bool:
    part = audio[int(a * 16000) : int(b * 16000)]
    return part.size > 0 and 20 * np.log10(np.sqrt(np.mean(part**2)) + 1e-9) >= SILENT_DB


def hear(whisper: WhisperModel, audio: np.ndarray,
         language: str | None) -> tuple[list[dict], str, list[list[float]]]:
    """Words Whisper hears in 16 kHz mono audio, the language, and stretches of vocals it couldn't make out."""

    def transcribe(part: np.ndarray, offset: float, lang: str | None) -> tuple[list[dict], str]:
        segments, info = whisper.transcribe(part, language=lang, word_timestamps=True, beam_size=5,
                                            condition_on_previous_text=False)
        return [{"word": w.word.strip(), "start": round(w.start + offset, 2), "end": round(w.end + offset, 2)}
                for s in segments for w in (s.words or [])], info.language

    words, language = transcribe(audio, 0.0, language)
    length = len(audio) / 16000
    unheard = []
    for a, b in gaps(words, 0.0, length):
        if not loud(audio, a, b):
            continue
        lo, hi = max(0.0, a - RELISTEN_CONTEXT), min(length, b + RELISTEN_CONTEXT)
        found = [w for w in transcribe(audio[int(lo * 16000) : int(hi * 16000)], lo, language)[0]
                 if w["end"] > a and w["start"] < b]
        words += found
        unheard += [[round(s, 2), round(e, 2)] for s, e in gaps(found, a, b) if loud(audio, s, e)]
    return sorted(words, key=lambda w: w["start"]), language, unheard


def demucs_splitter(name: str):
    """A function splitting a 44.1 kHz stereo array into (vocals, everything else) with a Demucs model."""
    model = get_model(name)
    model.eval()

    def split(audio: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        wav = torch.from_numpy(audio.T.copy())
        ref = wav.mean(0)
        mean, std = ref.mean(), ref.std() + 1e-8
        with torch.no_grad():
            sources = apply_model(model, ((wav - mean) / std)[None], device="cpu", progress=False)[0] * std + mean
        stems = dict(zip(model.sources, sources.numpy()))
        return stems.pop("vocals").T, sum(stems.values()).T

    return split


def roformer_splitter(tmp: str):
    from audio_separator.separator import Separator

    separator = Separator(output_dir=tmp, output_format="WAV", log_level=30,
                          mdxc_params={"segment_size": 256, "override_model_segment_size": False,
                                       "batch_size": 1, "overlap": 2, "pitch_shift": 0})
    separator.load_model(model_filename=ROFORMER)

    def split(audio: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        clip = Path(tmp) / "roformer_in.wav"
        sf.write(clip, audio, RATE)
        outs = [Path(tmp) / Path(p).name for p in separator.separate(str(clip))]
        vocals = sf.read(next(p for p in outs if "(Vocals)" in p.name), dtype="float32", always_2d=True)[0]
        instrumental = sf.read(next(p for p in outs if "(Instrumental)" in p.name), dtype="float32",
                               always_2d=True)[0]
        for p in outs:
            p.unlink(missing_ok=True)
        return vocals, instrumental

    return split


def leak(judge, instrumental: np.ndarray) -> float:
    """The largest share of vocals the judge finds in any second of the instrumental."""
    vocals, rest = judge(np.ascontiguousarray(instrumental, dtype=np.float32))
    worst = 0.0
    for s in range(0, len(vocals) - RATE + 1, RATE):
        v, r = float(np.sum(vocals[s : s + RATE] ** 2)), float(np.sum(rest[s : s + RATE] ** 2))
        if v + r > 1e-6:
            worst = max(worst, v / (v + r))
    return round(worst, 3)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    jobs = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    model = sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else MODELS[0]
    if model not in MODELS:
        sys.exit(f"--model must be one of {', '.join(MODELS)}")
    with tempfile.TemporaryDirectory() as tmp:
        split = roformer_splitter(tmp) if model == "bs_roformer" else demucs_splitter(model)
        judge = demucs_splitter(LEAK_JUDGE)
        whisper = WhisperModel(WHISPER, device="cpu", compute_type="int8")
        for job in jobs:
            try:
                audio, rate = sf.read(job["clip"], dtype="float32", always_2d=True)
                if rate != RATE:
                    raise ValueError(f"{job['clip']} must be {RATE} Hz (got {rate})")
                if audio.shape[1] == 1:
                    audio = np.repeat(audio, 2, axis=1)
                out = Path(job["out"])
                out.mkdir(parents=True, exist_ok=True)
                vocals, instrumental = split(audio)
                n = min(len(vocals), len(instrumental))
                mono = vocals.mean(axis=1)
                mono16 = np.interp(np.arange(0, len(mono), RATE / 16000), np.arange(len(mono)), mono)
                words, language, unheard = hear(whisper, mono16.astype(np.float32), job.get("language"))
                if job.get("wordless"):
                    vocable, unheard = [True] * len(words), []
                    gain = np.ones(n, dtype=np.float32)
                else:
                    if job.get("unclear_hook"):
                        unheard = []
                    vocable = classify(words, language, job.get("title") or "")
                    gain = vocal_gain(n, words, vocable, job.get("unsure_db", 0.0), unheard)
                sf.write(out / "mix.wav", instrumental[:n] + vocals[:n] * gain[:, None], RATE, subtype="FLOAT")
                (out / "words.json").write_text(json.dumps(
                    {"language": language, "words": [{**w, "vocable": v} for w, v in zip(words, vocable)],
                     "unheard": unheard, "model": model, "leak": leak(judge, instrumental[:n])},
                    ensure_ascii=False), encoding="utf-8")
                print(f"done {job['out']}", flush=True)
            except Exception as exc:
                print(f"failed {job['out']}: {exc}", flush=True)


if __name__ == "__main__":
    main()
