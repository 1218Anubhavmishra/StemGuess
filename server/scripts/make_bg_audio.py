"""Generate the seamless instrumental menu loop.

From server/:  python -m scripts.make_bg_audio

Writes client/public/audio/bg-loop.wav (8 bars at 120 BPM = 16 s, 22.05 kHz mono).
The track is rendered past the loop point and the overflow is crossfaded into the
start, so the end flows into the beginning without a click or gap.
"""

import math
import random
import struct
import wave
from pathlib import Path

RATE = 22050
BPM = 120
BARS = 8
CROSSFADE_SECONDS = 0.5
OUT = Path(__file__).resolve().parents[2] / "client" / "public" / "audio" / "bg-loop.wav"


def render(length: int) -> list[float]:
    rng = random.Random(7)
    beat = 60 / BPM
    roots = [110.0, 87.31, 130.81, 98.0]  # A, F, C, G
    out = []
    for i in range(length):
        t = i / RATE
        pos = t % beat
        root = roots[int(t / (beat * 4)) % len(roots)]
        kick = math.sin(2 * math.pi * (50 + 120 * math.exp(-pos * 30)) * pos) * math.exp(-pos * 9) * 0.55
        off = (t + beat / 2) % beat
        hat = rng.uniform(-1, 1) * math.exp(-off * 60) * 0.12
        bass = math.sin(2 * math.pi * root * t) * 0.18 * (0.6 + 0.4 * math.exp(-pos * 4))
        pad = sum(math.sin(2 * math.pi * root * 2 * r * t) for r in (1, 1.26, 1.5)) * 0.035
        out.append(kick + hat + bass + pad)
    return out


def main() -> None:
    loop = int(RATE * BARS * 4 * 60 / BPM)
    fade = int(RATE * CROSSFADE_SECONDS)
    audio = render(loop + fade)
    for i in range(fade):
        w = i / fade
        audio[i] = audio[i] * w + audio[loop + i] * (1 - w)
    audio = audio[:loop]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUT), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in audio))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
