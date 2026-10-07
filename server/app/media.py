import shutil
import subprocess
import wave
from pathlib import Path


def audio_duration(path: Path) -> float | None:
    """Length in seconds: WAV via the stdlib, anything else via ffprobe if installed."""
    if path.suffix.lower() == ".wav":
        try:
            with wave.open(str(path), "rb") as w:
                return w.getnframes() / w.getframerate()
        except (wave.Error, OSError):
            pass
    ffprobe = shutil.which("ffprobe")
    if not ffprobe or not path.exists():
        return None
    out = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True,
        text=True,
    )
    try:
        return float(out.stdout.strip())
    except ValueError:
        return None
