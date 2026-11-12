"""Mute stretches of a hits clip's vocals only (a DJ shout-out, a spoken line) and keep the instruments and every other vocal.

From server/:  python -m scripts.mute_vocals [--dry-run]        (needs DEMUCS_PYTHON, the Demucs environment)

Each row of hits_vocal_mutes.csv (title, artist, youtube, from, to, reason) names a song and a stretch of its clip in
seconds, with ";" between several stretches ("16.0-17.05;22.4-23.0" in `from`/`to` order is also fine as from=16.0;22.4
to=17.05;23.0). The song's clip is cut again exactly as full_mix_hits cuts it (hits_clip_starts.csv honoured), split
into vocals and instruments by split_vocals.py (htdemucs_ft), the vocals are faded out over those stretches (30 ms
ramps, no clicks), and the two are mixed back into a new "mix" stem. full_mix_hits leaves these songs to this script,
so a re-cut never brings the muted vocals back. Publish with publish_cc --prefix hits: as usual.
"""

import csv
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from app import config
from scripts.full_mix_hits import DONE, FFMPEG, LEAD_SILENCE, clip_starts, cut_dir, save
from scripts.import_hits import DEMUCS_PYTHON, HITS, read_hits, source_of
from scripts.progress import Progress

MUTES = HITS.with_name("hits_vocal_mutes.csv")
SPLITTER = Path(__file__).with_name("split_vocals.py")
RAMP = 0.03


def muted_songs() -> dict[str, list[tuple[float, float]]]:
    """Song source -> stretches of its clip (seconds) whose vocals are muted."""
    if not MUTES.exists():
        return {}
    out: dict[str, list[tuple[float, float]]] = {}
    with MUTES.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            row = {k: (v or "").strip() for k, v in row.items()}
            starts, ends = row["from"].split(";"), row["to"].split(";")
            out.setdefault(source_of(row), []).extend((float(a), float(b)) for a, b in zip(starts, ends))
    return out


def gain_expression(spans: list[tuple[float, float]]) -> str:
    """ffmpeg volume expression: 1 outside every span, 0 inside, with RAMP-second fades at the edges."""
    terms = [f"clip(max(({a}-t)/{RAMP},(t-{b})/{RAMP}),0,1)" for a, b in spans]
    expr = terms[0]
    for term in terms[1:]:
        expr = f"min({expr},{term})"
    return expr


def mute(hit: dict, spans: list[tuple[float, float]], start: float) -> Path:
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        seek = ["-ss", f"{start:.2f}"] if start else []
        subprocess.run([FFMPEG, "-y", "-v", "error", *seek, "-i", hit["file"], "-vn", "-af", LEAD_SILENCE,
                        "-t", str(config.CLIP_SECONDS), "-ac", "2", "-ar", "44100", "-c:a", "pcm_f32le",
                        str(tmp / "clip.wav")], check=True)
        subprocess.run([DEMUCS_PYTHON, "-X", "utf8", str(SPLITTER), str(tmp / "clip.wav"), str(tmp)], check=True)
        dest = cut_dir() / "mix.mp3"
        subprocess.run([FFMPEG, "-y", "-v", "error", "-i", str(tmp / "vocals.wav"), "-i", str(tmp / "instruments.wav"),
                        "-filter_complex", f"[0]volume='{gain_expression(spans)}':eval=frame[v];"
                                           "[v][1]amix=inputs=2:normalize=0",
                        "-ac", "2", "-b:a", "160k", str(dest)], check=True)
        return dest


def main() -> None:
    mutes = muted_songs()
    hits = {source_of(h): h for h in read_hits() if source_of(h) in mutes}
    missing = set(mutes) - set(hits)
    if missing:
        print(f"not in hits.csv, skipped: {sorted(missing)}")
    if "--dry-run" in sys.argv:
        for src, h in hits.items():
            print(f"{h['title']} - {h['artist']}: mute vocals at {mutes[src]}")
        return
    starts = clip_starts()
    done = set(json.loads(DONE.read_text(encoding="utf-8"))) if DONE.exists() else set()
    progress = Progress(len(hits), "songs to mute")
    for src, hit in hits.items():
        save(hit, mute(hit, mutes[src], starts.get(src, 0.0)))
        done.add(src)
        DONE.write_text(json.dumps(sorted(done), indent=0), encoding="utf-8")
        progress.step(f"{hit['title']} - {hit['artist']}: vocals muted at {mutes[src]}")


if __name__ == "__main__":
    main()
