"""Generates client/public/audio/bg-loop.flac: an original waltz on nylon guitar that loops without a seam.

Everything is synthesised here, so there's nothing to license. Notes and reverb wrap around the end of the
loop, so the tail of the last bar rings on into the first.

    python client/scripts/make_bg_music.py [--instrument NAME] [--piece NAME] [--out FILE]   (needs numpy and ffmpeg)
"""
import argparse
import subprocess
import wave
from pathlib import Path

import numpy as np

RATE = 32000
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


def hz(note: int) -> float:
    return 440 * 2 ** ((note - 69) / 12)


def times(seconds: float, ring: float, longest: float = 7.0) -> np.ndarray:
    return np.arange(int(min(seconds + ring, longest) * RATE)) / RATE


def plucked(note, seconds, velocity, rng, position, rolloff, decay_base, decay_rise, ring, attack_s, count=24):
    """A plucked string: the pluck's position shapes the harmonics, and the highs die away first."""
    f0 = hz(note)
    t = times(seconds, ring)
    out = np.zeros(len(t))
    for n in range(1, count + 1):
        if n * f0 > RATE * 0.42:
            break
        level = abs(np.sin(n * np.pi * position)) * velocity ** (0.6 + 0.12 * n) / n**rolloff
        decay = decay_base + decay_rise * n * (f0 / 220) ** 0.4
        out += level * np.exp(-t * decay) * np.sin(2 * np.pi * n * f0 * t + rng.uniform(0, 2 * np.pi))
    release = np.clip(1 - (t - seconds) / ring, 0, 1) ** 2
    return out * np.minimum(1, t / attack_s) * release


def guitar_note(note, seconds, velocity, rng):
    """Nylon-string guitar: a soft thumb pluck near the bridge, with a short ring."""
    return plucked(note, seconds, velocity, rng, 0.2, 1.05, 0.9, 0.3, 1.1, 0.003)


def soft_guitar_note(note, seconds, velocity, rng):
    """Nylon guitar played with the flesh of the finger: no pick edge, even dynamics, and notes that ring together."""
    even = 0.3 + 0.6 * velocity
    return plucked(note, seconds * 1.3, even, rng, 0.3, 1.4, 0.7, 0.45, 2.2, 0.012, count=14)


def harp_note(note, seconds, velocity, rng):
    """Concert harp: plucked mid-string, so round and hollow, and it rings on."""
    return plucked(note, seconds, velocity, rng, 0.42, 1.5, 0.45, 0.2, 2.6, 0.005)


def bars(note, seconds, velocity, rng, ratios, levels, decays, ring, attack_s, tremolo=0.0):
    """A struck metal bar: fixed, non-harmonic partials that fade at their own rates."""
    f0 = hz(note)
    t = times(seconds, ring)
    out = np.zeros(len(t))
    for ratio, level, decay in zip(ratios, levels, decays):
        if ratio * f0 > RATE * 0.42:
            continue
        brightness = velocity if ratio > 1 else 1
        out += level * brightness * np.exp(-t * decay) * np.sin(2 * np.pi * ratio * f0 * t + rng.uniform(0, 2 * np.pi))
    if tremolo:
        out *= 1 - tremolo * (0.5 + 0.5 * np.sin(2 * np.pi * 4.6 * t))
    release = np.clip(1 - (t - seconds) / ring, 0, 1) ** 2
    return velocity * out * np.minimum(1, t / attack_s) * release


def music_box_note(note, seconds, velocity, rng):
    """Music box: a plucked steel tine, glassy and high, that rings freely whatever the note's length."""
    return bars(note, 0.1, velocity, rng, (1, 2.0, 5.4, 8.9), (1, 0.12, 0.28, 0.12), (1.3, 2.4, 7, 14), 3.2, 0.001)


def vibraphone_note(note, seconds, velocity, rng):
    """Vibraphone: soft mallets on aluminium bars, with the slow shimmer of its motor."""
    return bars(note, seconds, velocity, rng, (1, 4, 10), (1, 0.16, 0.03), (0.8, 3, 9), 1.4, 0.004, tremolo=0.3)


def electric_piano_note(note, seconds, velocity, rng):
    """Electric piano: two-operator FM, warm body with a little bell at the start of each note."""
    f0 = hz(note)
    t = times(seconds, 0.6)
    out = np.zeros(len(t))
    for detune in (-0.5, 0.5):
        phase = rng.uniform(0, 2 * np.pi)
        body = (0.25 + 1.5 * velocity * np.exp(-t * 2.5)) * np.sin(2 * np.pi * f0 * t + phase)
        bell = 0.4 * velocity * np.exp(-t * 11) * np.sin(2 * np.pi * 14 * f0 * t)
        out += np.sin(2 * np.pi * (f0 + detune) * t + phase + body + bell)
    envelope = 0.65 * np.exp(-t * 1.5) + 0.35 * np.exp(-t * 0.35)
    release = np.clip(1 - (t - seconds) / 0.6, 0, 1) ** 2
    return 0.5 * velocity * out * envelope * np.minimum(1, t / 0.002) * release


def strings_note(note, seconds, velocity, rng):
    """Soft string ensemble: several slightly detuned bowed voices, swelling in and fading slowly."""
    f0 = hz(note)
    t = times(seconds, 1.0)
    out = np.zeros(len(t))
    for detune in (-0.0035, -0.0012, 0.0012, 0.0035):
        vibrato = 0.002 * np.sin(2 * np.pi * rng.uniform(4.4, 5.4) * t + rng.uniform(0, 2 * np.pi))
        for n in range(1, 13):
            if n * f0 > RATE * 0.42:
                break
            frequency = n * f0 * (1 + detune)
            phase = 2 * np.pi * frequency * (t + np.cumsum(vibrato) / RATE)
            out += np.sin(phase + rng.uniform(0, 2 * np.pi)) / n**1.7
    swell = min(0.16, max(0.05, seconds * 0.3))
    release = np.clip(1 - (t - seconds) / 1.0, 0, 1) ** 2
    return 0.3 * velocity * out * np.minimum(1, t / swell) ** 2 * release


# name -> (one note's sound, semitones to move the accompaniment, semitones to move the tune).
INSTRUMENTS = {
    'piano': (piano_note, 0, 0),
    'guitar': (guitar_note, 0, -12),
    'soft-guitar': (soft_guitar_note, 0, -12),
    'harp': (harp_note, 0, 0),
    'music-box': (music_box_note, 12, 12),
    'vibraphone': (vibraphone_note, 12, 0),
    'electric-piano': (electric_piano_note, 0, -12),
    'strings': (strings_note, 0, -12),
}
# How loud the piano version is, so every instrument sits at the same level.
TARGET_RMS = 0.231
# The reverb, as (seconds long, how fast it fades, how much of it): a small warm room, or a larger soft one.
ROOM = (1.6, 3.2, 0.22)
SOFT_ROOM = (2.6, 2.0, 0.42)
MAX_DRIVE = 2.0


# chord -> the left hand's broken chord, played as eighth notes.
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

# A second piece: a gentle waltz in D major.
WALTZ_LEFT = {
    'D': ['D3', 'A3', 'D4', 'F#4', 'D4', 'A3'],
    'Bm': ['B2', 'F#3', 'B3', 'D4', 'B3', 'F#3'],
    'G': ['G2', 'D3', 'G3', 'B3', 'G3', 'D3'],
    'A': ['A2', 'E3', 'A3', 'C#4', 'A3', 'E3'],
    'Em': ['E2', 'B2', 'E3', 'G3', 'E3', 'B2'],
    'F#m': ['F#2', 'C#3', 'F#3', 'A3', 'F#3', 'C#3'],
}
WALTZ_CHORDS = [
    'D', 'Bm', 'G', 'A', 'D', 'Bm', 'Em', 'A',
    'G', 'D', 'Em', 'Bm', 'G', 'D', 'Em', 'A',
    'Bm', 'F#m', 'G', 'D', 'Em', 'A', 'D', 'A',
]
WALTZ_TUNE = [
    (0, 0, 'A5', 1.5), (0, 1.5, 'F#5', 0.5), (0, 2, 'D5', 1),
    (1, 0, 'B4', 1), (1, 1, 'D5', 1), (1, 2, 'F#5', 1),
    (2, 0, 'G5', 1.5), (2, 1.5, 'A5', 0.5), (2, 2, 'B5', 1),
    (3, 0, 'A5', 2), (3, 2, 'E5', 1),
    (4, 0, 'F#5', 1.5), (4, 1.5, 'A5', 0.5), (4, 2, 'D6', 1),
    (5, 0, 'B5', 2), (5, 2, 'F#5', 1),
    (6, 0, 'G5', 1.5), (6, 1.5, 'E5', 0.5), (6, 2, 'B4', 1),
    (7, 0, 'C#5', 2), (7, 2, 'E5', 1),
    (8, 0, 'B5', 1.5), (8, 1.5, 'A5', 0.5), (8, 2, 'G5', 1),
    (9, 0, 'A5', 2), (9, 2, 'F#5', 1),
    (10, 0, 'G5', 1.5), (10, 1.5, 'F#5', 0.5), (10, 2, 'E5', 1),
    (11, 0, 'F#5', 2), (11, 2, 'D5', 1),
    (12, 0, 'D5', 1), (12, 1, 'G5', 1), (12, 2, 'B5', 1),
    (13, 0, 'A5', 1.5), (13, 1.5, 'F#5', 0.5), (13, 2, 'D5', 1),
    (14, 0, 'E5', 1), (14, 1, 'G5', 1), (14, 2, 'B5', 1),
    (15, 0, 'A5', 1.5), (15, 1.5, 'G5', 0.5), (15, 2, 'E5', 1),
    (16, 0, 'F#5', 1.5), (16, 1.5, 'E5', 0.5), (16, 2, 'D5', 1),
    (17, 0, 'C#5', 2), (17, 2, 'F#5', 1),
    (18, 0, 'D5', 1.5), (18, 1.5, 'B4', 0.5), (18, 2, 'G5', 1),
    (19, 0, 'F#5', 3),
    (20, 0, 'G5', 1.5), (20, 1.5, 'A5', 0.5), (20, 2, 'B5', 1),
    (21, 0, 'A5', 1.5), (21, 1.5, 'G5', 0.5), (21, 2, 'E5', 1),
    (22, 0, 'F#5', 1), (22, 1, 'D5', 1), (22, 2, 'A4', 1),
    (23, 0, 'E5', 2), (23, 2, 'C#5', 1),
]

# name -> (beats per minute, beats in a bar, chord shapes, chords per bar, tune).
PIECES = {
    'minor': (72, 4, LEFT, CHORDS, TUNE),
    'waltz': (96, 3, WALTZ_LEFT, WALTZ_CHORDS, WALTZ_TUNE),
}


def place(track: np.ndarray, sound: np.ndarray, at: int, pan: float) -> None:
    """Adds a stereo-panned note at sample `at`, wrapping past the end of the loop back to its start."""
    loop = track.shape[1]
    index = (at + np.arange(len(sound))) % loop
    np.add.at(track[0], index, sound * np.cos((pan + 1) * np.pi / 4))
    np.add.at(track[1], index, sound * np.sin((pan + 1) * np.pi / 4))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--instrument', choices=INSTRUMENTS, default='soft-guitar')
    parser.add_argument('--piece', choices=PIECES, default='waltz')
    parser.add_argument('--out', type=Path, default=OUT)
    args = parser.parse_args()
    make_note, left_shift, tune_shift = INSTRUMENTS[args.instrument]
    out = args.out
    bpm, bar_beats, shapes, chords, tune = PIECES[args.piece]
    beat_seconds = 60 / bpm
    loop = int(round(len(chords) * bar_beats * beat_seconds * RATE))

    def sample_at(beat: float) -> int:
        return int(beat * beat_seconds * RATE)

    rng = np.random.default_rng(72)
    track = np.zeros((2, loop))

    for bar, chord in enumerate(chords):
        shape = shapes[chord]
        for i, name in enumerate(shape):
            note = midi(name) + left_shift
            accent = 0.62 if i == 0 else 0.42 if i == len(shape) // 2 else 0.34
            velocity = accent + rng.uniform(-0.02, 0.02)
            # The sustain pedal: chord tones ring until near the end of the bar.
            seconds = (len(shape) - i) * 0.5 * beat_seconds
            place(track, make_note(note, seconds, velocity, rng), sample_at(bar * bar_beats + i * 0.5), (note - 60) / 60)

    for bar, beat, name, beats in tune:
        velocity = 0.86 + rng.uniform(-0.04, 0.04) + (0.05 if beat == 0 else 0)
        seconds = beats * beat_seconds * 1.05
        place(track, make_note(midi(name) + tune_shift, seconds, velocity, rng), sample_at(bar * bar_beats + beat), 0.12)

    # The room: decaying noise, convolved around the loop so the reverb wraps too.
    room_seconds, room_fade, room_level = SOFT_ROOM if args.instrument == 'soft-guitar' else ROOM
    tail = int(room_seconds * RATE)
    time = np.arange(tail) / RATE
    wet = np.zeros_like(track)
    for side in range(2):
        impulse = np.zeros(loop)
        impulse[:tail] = rng.normal(0, 1, tail) * np.exp(-time * room_fade)
        # Soften the reverb's highs.
        impulse[:tail] = np.convolve(impulse[:tail], np.ones(6) / 6, mode='same')
        impulse /= np.sqrt(np.sum(impulse**2))
        wet[side] = np.fft.irfft(np.fft.rfft(track[side]) * np.fft.rfft(impulse), loop)
    mix = track + room_level * wet

    # Gentle limiting lifts the quiet notes, then a peak of -1.5 dB.
    mix = mix / np.max(np.abs(mix))
    mix = np.tanh(mix * 1.5)
    ceiling = 10 ** (-1.5 / 20)
    mix = mix / np.max(np.abs(mix)) * ceiling
    if args.instrument != 'piano':
        # Towards the piano's loudness, with limited drive: spiky sounds would distort if forced all the way.
        drive = min(TARGET_RMS / np.sqrt(np.mean(mix**2)), MAX_DRIVE)
        mix = np.tanh(mix * drive / ceiling) * ceiling
        mix = mix * min(TARGET_RMS / np.sqrt(np.mean(mix**2)), ceiling / np.max(np.abs(mix)))

    print(f'rms {np.sqrt(np.mean(mix**2)):.4f} peak {np.max(np.abs(mix)):.3f}')
    pcm = (mix.T * 32767).astype(np.int16)
    temp = out.with_suffix('.tmp.wav')
    with wave.open(str(temp), 'wb') as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(pcm.tobytes())
    subprocess.run(
        ['ffmpeg', '-y', '-loglevel', 'error', '-i', str(temp), '-compression_level', '12', str(out)], check=True
    )
    temp.unlink()
    print(out, f'{loop / RATE:.1f} s', f'{out.stat().st_size / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
