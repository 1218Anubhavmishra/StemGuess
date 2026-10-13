"""Split a short WAV clip into stems with Demucs, without the vocals.

Runs in its own environment (Demucs needs PyTorch, which the server doesn't):
    python separate.py <clip.wav> <output dir>
writes drums.wav, bass.wav and other.wav into the output dir.
"""

import sys
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model

KEEP = ("drums", "bass", "other")


def main() -> None:
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    model = get_model("htdemucs")
    model.eval()
    audio, rate = sf.read(src, dtype="float32", always_2d=True)
    if rate != model.samplerate:
        sys.exit(f"{src} must be {model.samplerate} Hz (got {rate})")
    if audio.shape[1] == 1:
        audio = np.repeat(audio, 2, axis=1)
    wav = torch.from_numpy(audio.T.copy())
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    with torch.no_grad():
        sources = apply_model(model, ((wav - mean) / std)[None], device="cpu", progress=False)[0]
    sources = sources * std + mean
    out.mkdir(parents=True, exist_ok=True)
    for name, stem in zip(model.sources, sources):
        if name in KEEP:
            sf.write(out / f"{name}.wav", stem.numpy().T, model.samplerate)


if __name__ == "__main__":
    main()
