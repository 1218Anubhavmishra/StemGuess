"""Generates client/public/audio/bg-loop.flac: an original solo piano piece that loops without a seam.

Everything is synthesised here, so there's nothing to license. Notes and reverb wrap around the end of the
loop, so the tail of the last bar rings on into the first.

    python client/scripts/make_bg_music.py   (needs numpy and ffmpeg)
"""
import subprocess
import wave
from pathlib import Path

import numpy as np

RATE = 32000
BPM = 72
BEAT = 60 / BPM
BARS = 16
LOOP = int(round(BARS * 4 * BEAT * RATE))
OUT = Path(__file__).resolve().parents[1] / 'public' / 'audio' / 'bg-loop.flac'

NAMES = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def midi(name: str) -> int:
    """'A4', 'F#3' -> MIDI note number."""
    sharp = 1 if '#' in name else 0
    return 12 * (int(name[-1]) + 1) + NAMES[name[0]] + sharp


def piano_note(note: int, seconds: float, velocity: float, rng: np.random.Generator) -> np.ndarray:
    """One struck note: slightly detuned strings, stretched partials, and highs that die away first."""
    f0 = 440 * 2 ** ((note - 69) / 12)
    length = int(min(seconds + 2.2, 6) * RATE)
    t = np.arange(length) / RATE
    inharmonic = 0.00035 * (f0 / 261.6) ** 0.5
    out = np.zeros(length)
    for n in range(1, 16):
        partial = n * f0 * np.sqrt(1 + inharmonic * n * n)
        if partial > RATE * 0.42:
            break
        # Harder hits are brighter; every partial is quieter the higher it is.
        level = velocity ** (1 + 0.28 * (n - 1)) / n ** 1.35
        decay = 0.55 + 0.22 * n * (f0 / 261.6) ** 0.55
        envelope = 0.72 * np.exp(-t * decay) + 0.28 * np.exp(-t * decay * 0.22)
        for detune, share in ((-0.25, 0.4), (0.0, 0.3), (0.3, 0.3)):
            phase = rng.uniform(0, 2 * np.pi)
            out += share * level * envelope * np.sin(2 * np.pi * (partial + detune) * t + phase)
    # The hammer: a tiny felted thump at the very start.
    thump = rng.normal(0, 1, length) * np.exp(-t * 180)
    thump = np.convolve(thump, np.ones(9) / 9, mode='same')
    out += 0.05 * velocity * thump
    # A quick attack, and a damper release after the note's length.
    attack = np.minimum(1, t / 0.0025)
    release = np.clip(1 - (t - seconds) / 0.45, 0, 1) ** 2
    return out * attack * release


# bar -> the left hand's broken chord, played as eighth notes.
LEFT = {
    'Am': ['A2', 'E3', 'A3', 'C4', 'E4', 'C4', 'A3', 'E3'],
    'F': ['F2', 'C3', 'F3', 'A3', 'C4', 'A3', 'F3', 'C3'],
    'C': ['C3', 'G3', 'C4', 'E4', 'G4', 'E4', 'C4', 'G3'],
    'G': ['G2', 'D3', 'G3', 'B3', 'D4', 'B3', 'G3', 'D3'],
    'Dm': ['D3', 'A3', 'D4', 'F4', 'A4', 'F4', 'D4', 'A3'],
    'E': ['E2', 'B2', 'E3', 'G#3', 'B3', 'G#3', 'E3', 'B2'],
}
CHORDS = ['Am', 'F', 'C', 'G', 'Am', 'F', 'Dm', 'E', 'F', 'C', 'G', 'Am', 'Dm', 'Am', 'F', 'E']

# The right hand's tune: (bar, beat, note, beats).
TUNE = [
    (0, 0, 'E5', 1.5), (0, 1.5, 'C5', 0.5), (0, 2, 'D5', 1), (0, 3, 'E5', 1),
    (1, 0, 'F5', 1.5), (1, 1.5, 'E5', 0.5), (1, 2, 'C5', 2),
    (2, 0, 'G5', 1.5), (2, 1.5, 'F5', 0.5), (2, 2, 'E5', 1), (2, 3, 'C5', 1),
    (3, 0, 'D5', 3), (3, 3, 'B4', 1),
    (4, 0, 'C5', 1.5), (4, 1.5, 'D5', 0.5), (4, 2, 'E5', 1), (4, 3, 'A5', 1),
    (5, 0, 'A5', 1), (5, 1, 'G5', 0.5), (5, 1.5, 'F5', 0.5), (5, 2, 'C5', 2),
    (6, 0, 'D5', 1), (6, 1, 'F5', 1), (6, 2, 'A5', 1), (6, 3, 'F5', 1),
    (7, 0, 'E5', 2), (7, 2, 'G#5', 1), (7, 3, 'B5', 1),
    (8, 0, 'C6', 1.5), (8, 1.5, 'A5', 0.5), (8, 2, 'F5', 2),
    (9, 0, 'G5', 1.5), (9, 1.5, 'E5', 0.5), (9, 2, 'C5', 2),
    (10, 0, 'D5', 1), (10, 1, 'G5', 1), (10, 2, 'B5', 1), (10, 3, 'D6', 1),
    (11, 0, 'C6', 2), (11, 2, 'A5', 1), (11, 3, 'E5', 1),
    (12, 0, 'F5', 1.5), (12, 1.5, 'E5', 0.5), (12, 2, 'D5', 1), (12, 3, 'A5', 1),
    (13, 0, 'E5', 1.5), (13, 1.5, 'D5', 0.5), (13, 2, 'C5', 2),
    (14, 0, 'A4', 1), (14, 1, 'C5', 1), (14, 2, 'F5', 1), (14, 3, 'E5', 1),
    (15, 0, 'E5', 2), (15, 2, 'D5', 1), (15, 3, 'B4', 1),
]


def place(track: np.ndarray, sound: np.ndarray, beat: float, pan: float) -> None:
    """Adds a stereo-panned note, wrapping past the end of the loop back to its start."""
    at = int(beat * BEAT * RATE)
    index = (at + np.arange(len(sound))) % LOOP
    np.add.at(track[0], index, sound * np.cos((pan + 1) * np.pi / 4))
    np.add.at(track[1], index, sound * np.sin((pan + 1) * np.pi / 4))


def main() -> None:
    rng = np.random.default_rng(72)
    track = np.zeros((2, LOOP))

    for bar, chord in enumerate(CHORDS):
        for i, name in enumerate(LEFT[chord]):
            note = midi(name)
            accent = 0.62 if i == 0 else 0.42 if i == 4 else 0.34
            velocity = accent + rng.uniform(-0.02, 0.02)
            # The sustain pedal: chord tones ring until near the end of the bar.
            seconds = (8 - i) * 0.5 * BEAT
            place(track, piano_note(note, seconds, velocity, rng), bar * 4 + i * 0.5, (note - 60) / 60)

    for bar, beat, name, beats in TUNE:
        velocity = 0.86 + rng.uniform(-0.04, 0.04) + (0.05 if beat == 0 else 0)
        seconds = beats * BEAT * 1.05
        place(track, piano_note(midi(name), seconds, velocity, rng), bar * 4 + beat, 0.12)

    # A small warm room: decaying noise, convolved around the loop so the reverb wraps too.
    tail = int(1.6 * RATE)
    time = np.arange(tail) / RATE
    wet = np.zeros_like(track)
    for side in range(2):
        impulse = np.zeros(LOOP)
        impulse[:tail] = rng.normal(0, 1, tail) * np.exp(-time * 3.2)
        # Soften the reverb's highs.
        impulse[:tail] = np.convolve(impulse[:tail], np.ones(6) / 6, mode='same')
        impulse /= np.sqrt(np.sum(impulse**2))
        wet[side] = np.fft.irfft(np.fft.rfft(track[side]) * np.fft.rfft(impulse), LOOP)
    mix = track + 0.22 * wet

    # Gentle limiting lifts the quiet notes, then a peak of -1.5 dB.
    mix = mix / np.max(np.abs(mix))
    mix = np.tanh(mix * 1.5)
    mix = mix / np.max(np.abs(mix)) * 10 ** (-1.5 / 20)

    pcm = (mix.T * 32767).astype(np.int16)
    temp = OUT.with_suffix('.tmp.wav')
    with wave.open(str(temp), 'wb') as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(pcm.tobytes())
    subprocess.run(
        ['ffmpeg', '-y', '-loglevel', 'error', '-i', str(temp), '-compression_level', '12', str(OUT)], check=True
    )
    temp.unlink()
    print(OUT, f'{LOOP / RATE:.1f} s', f'{OUT.stat().st_size / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
