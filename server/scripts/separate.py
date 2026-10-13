"""Split short WAV clips into stems with Demucs, without the vocals.

Runs in its own environment (Demucs needs PyTorch, which the server doesn't):
    python separate.py <jobs.json>
where jobs.json is a list of {"clip": <wav path>, "out": <output dir>}. The model is loaded once for
the whole batch; each output dir gets drums.wav, bass.wav and other.wav. Prints "done <out>" per clip.
Uses an NVIDIA GPU when there is one, otherwise every CPU core.
"""

import json
import os
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model

KEEP = ("drums", "bass", "other")


def separate(model, device: str, src: Path, out: Path) -> None:
    audio, rate = sf.read(src, dtype="float32", always_2d=True)
    if rate != model.samplerate:
        raise ValueError(f"{src} must be {model.samplerate} Hz (got {rate})")
    if audio.shape[1] == 1:
        audio = np.repeat(audio, 2, axis=1)
    wav = torch.from_numpy(audio.T.copy())
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    with torch.no_grad():
        sources = apply_model(model, ((wav - mean) / std)[None], device=device, progress=False)[0]
    sources = sources * std + mean
    out.mkdir(parents=True, exist_ok=True)
    for name, stem in zip(model.sources, sources):
        if name in KEEP:
            sf.write(out / f"{name}.wav", stem.cpu().numpy().T, model.samplerate)


def main() -> None:
    jobs = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        torch.set_num_threads(os.cpu_count() or 1)
    model = get_model("htdemucs")
    model.eval()
    for job in jobs:
        try:
            separate(model, device, Path(job["clip"]), Path(job["out"]))
            print(f"done {job['out']}", flush=True)
        except Exception as exc:
            print(f"failed {job['out']}: {exc}", flush=True)


if __name__ == "__main__":
    main()
