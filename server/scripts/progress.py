"""Progress lines for scripts that work through a set of songs: "[37/102  12:40 elapsed, ~20:15 left] ...".

No dependencies, so separate.py (which runs in the Demucs environment) can use it too.
"""

import time


def clock(seconds: float) -> str:
    seconds = int(seconds)
    hours, rest = divmod(seconds, 3600)
    return f"{hours}:{rest // 60:02d}:{rest % 60:02d}" if hours else f"{rest // 60}:{rest % 60:02d}"


class Progress:
    def __init__(self, total: int, what: str = "songs"):
        self.total, self.done, self.started = total, 0, time.monotonic()
        print(f"{total} {what}", flush=True)

    def status(self) -> str:
        elapsed = time.monotonic() - self.started
        left = f", ~{clock(elapsed / self.done * (self.total - self.done))} left" if 0 < self.done < self.total else ""
        return f"[{self.done}/{self.total}  {clock(elapsed)} elapsed{left}]"

    def step(self, message: str) -> None:
        """One more item finished (or failed); prints the message after the progress."""
        self.done += 1
        print(f"{self.status()} {message}", flush=True)

    def note(self, message: str) -> None:
        """A line about the current item that doesn't count as finishing one."""
        print(f"{self.status()}   {message}", flush=True)
