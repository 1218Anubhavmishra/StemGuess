"""Split a 44.1 kHz stereo WAV into vocals.wav and instruments.wav with a Demucs model.
Runs in the Demucs environment (DEMUCS_PYTHON); mute_vocals.py calls it.

  <DEMUCS_PYTHON> split_vocals.py IN.wav OUT_DIR [MODEL]     (MODEL: htdemucs_ft by default)
"""
import sys
from pathlib import Path

import soundfile as sf

sys.path.insert(0, str(Path(__file__).parent))
from separate_vocables import demucs_splitter  # noqa: E402


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    model = sys.argv[3] if len(sys.argv) > 3 else "htdemucs_ft"
    audio, rate = sf.read(src, dtype="float32", always_2d=True)
    if rate != 44100 or audio.shape[1] != 2:
        sys.exit(f"{src} must be 44.1 kHz stereo")
    vocals, rest = demucs_splitter(model)(audio)
    out.mkdir(parents=True, exist_ok=True)
    sf.write(out / "vocals.wav", vocals, rate, subtype="FLOAT")
    sf.write(out / "instruments.wav", rest, rate, subtype="FLOAT")
    print(f"split {src.name} with {model}: {len(audio) / rate:.1f} s")


if __name__ == "__main__":
    main()
