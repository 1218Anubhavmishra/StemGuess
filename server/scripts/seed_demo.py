"""Add 47 synthetic demo songs, one per music genre (generated audio, no Music.ai needed).

From server/:  python -m scripts.seed_demo               (write missing files + add songs to the database)
               python -m scripts.seed_demo --files-only  (just write missing files, e.g. during a deploy build)

Safe to run repeatedly: existing files are kept and existing songs are updated in place.
Each song is rendered from its genre recipe below; its melody is generated from a seed of its title,
so every song has its own tune and builds are reproducible.
"""

import json
import math
import random
import secrets
import shutil
import sys
import wave
from array import array
from pathlib import Path

from sqlalchemy import select

from app import config
from app.db import SessionLocal, init_db
from app.models import Song, Stem

RATE = 22050
TARGET_SECONDS = 15
STEM_NAMES = ("drums", "bass", "keys", "vocals")
# Bump whenever the sound changes, so every demo is re-rendered into fresh random folders.
VERSION = 2
TAU = 2 * math.pi

SCALES = {
    "major": (0, 2, 4, 5, 7, 9, 11),
    "minor": (0, 2, 3, 5, 7, 8, 10),
    "dorian": (0, 2, 3, 5, 7, 9, 10),
    "phrygian": (0, 1, 3, 5, 7, 8, 10),
    "blues": (0, 3, 5, 6, 7, 10),
    "pent_major": (0, 2, 4, 7, 9),
    "pent_minor": (0, 3, 5, 7, 10),
    "bhairav": (0, 1, 4, 5, 7, 8, 11),
    "mixolydian": (0, 2, 4, 5, 7, 9, 10),
    "hijaz": (0, 1, 4, 5, 7, 8, 10),
    "harmonic_minor": (0, 2, 3, 5, 7, 8, 11),
    "pelog": (0, 1, 3, 7, 8),
}
QUALITIES = {
    "maj": (0, 4, 7),
    "min": (0, 3, 7),
    "7": (0, 4, 7, 10),
    "m7": (0, 3, 7, 10),
    "maj7": (0, 4, 7, 11),
    "9": (0, 4, 7, 10, 14),
    "5": (0, 7, 12),
    "sus": (0, 5, 7),
}
# Chance of a melody note starting on each 16th of a beat.
RHYTHMS = {
    "long": (0.45, 0, 0.1, 0),
    "sparse": (0.6, 0, 0.3, 0),
    "even8": (0.85, 0, 0.55, 0),
    "syncop": (0.5, 0.1, 0.55, 0.35),
    "busy": (0.8, 0.45, 0.7, 0.45),
}
# Pattern strings have one character per 16th note: X/x/g are loud/normal/ghost hits, "-" holds, "." rests.
VELOCITY = {"X": 1.0, "x": 0.8, "g": 0.35}
# Bass line characters: chord root, third, fifth, sixth, flat seventh, octave.
BASS_STEPS = {"r": 0, "f": 7, "6": 9, "s": 10, "o": 12}

GENRES = {
    "pop": dict(
        bpm=118, key=0, scale="major", prog=[(0, "maj"), (7, "maj"), (9, "min"), (5, "maj")],
        drums={"kick": "x.....x.x.......", "snare": "....x.......x...", "clap": "....g.......g...",
               "hat": "x.x.x.x.x.x.x.x."},
        crash=True, bass="synth_bass", bass_line="r-r-r-r-r-r-r-r-", keys="piano", comp="x---x---x---x-x-",
        lead="voice:a", rhythm="syncop", legato=True),
    "house": dict(
        bpm=124, key=9, scale="minor", prog=[(0, "m7"), (5, "m7"), (8, "maj7"), (10, "maj")],
        drums={"kick": "x...x...x...x...", "clap": "....x.......x...", "ohat": "..x...x...x...x.",
               "shaker": "xgxgxgxgxgxgxgxg"},
        bass="sub", bass_line="..r-..r-..r-..r-", keys="piano", comp="...x--x....x--x.",
        lead="voice:e", rhythm="sparse", legato=True),
    "rock": dict(
        bpm=132, key=4, scale="pent_minor", prog=[(0, "5"), (3, "5"), (5, "5"), (0, "5")],
        drums={"kick": "x.......x.x.....", "snare": "....x.......x...", "hat": "x.x.x.x.x.x.x.x."},
        crash=True, fill=True, bass="picked", bass_line="r-r-r-r-r-r-r-r-", keys="dist", keys_low=40,
        comp="x-.xx-.xx-.xx-.x", lead="voice:a", rhythm="even8", legato=True, lead_range=(64, 81)),
    "synthwave": dict(
        bpm=100, key=9, scale="minor", prog=[(0, "min"), (8, "maj"), (3, "maj"), (10, "maj")],
        drums={"kick": "x.......x.......", "snare": "....X.......X...", "hat": "xgggxgggxgggxggg"},
        crash=True, bass="synth_bass", bass_line="rorororororororo", keys="pad", comp="x---------------",
        lead="square", rhythm="long", legato=True),
    "metal": dict(
        bpm=150, key=4, scale="phrygian", prog=[(0, "5"), (1, "5"), (0, "5"), (3, "5")],
        drums={"kick": "xxxxxxxxxxxxxxxx", "snare": "....X.......X...", "hat": "x.x.x.x.x.x.x.x."},
        crash=True, fill=True, bass="dist_bass", bass_line="rrrrrrrrrrrrrrrr", keys="dist", keys_low=40,
        comp="x.xxx.xxx.xxx.xx", lead="guitar_lead", rhythm="busy", legato=False),
    "drum_and_bass": dict(
        bpm=174, key=2, scale="minor", prog=[(0, "m7"), (8, "maj7"), (5, "m7"), (10, "maj")],
        drums={"kick": "x.........x.....", "snare": "....x..g.g..x..g", "hat": "x.x.x.x.x.x.x.x."},
        bass="reese", bass_line="r-------------o-", keys="pad", comp="x---------------",
        lead="voice:o", rhythm="sparse", legato=True),
    "reggaeton": dict(
        bpm=95, key=9, scale="minor", prog=[(0, "min"), (5, "min"), (8, "maj"), (7, "maj")],
        drums={"kick": "x...x...x...x...", "snare": "...x..x....x..x.", "hat": "x.x.x.x.x.x.x.x."},
        bass="808", bass_line="r---r---r---r---", keys="guitar", comp="x..x..x.x..x..x.",
        lead="voice:i", rhythm="syncop", legato=True),
    "blues": dict(
        bpm=120, key=4, scale="blues", swing=(1.0, 8),
        prog=[(0, "7"), (5, "7"), (0, "7"), (0, "7"), (5, "7"), (5, "7"), (0, "7"), (7, "7")],
        drums={"kick": "x.......x.......", "snare": "....x.......x...", "ride": "x...x.x.x...x.x."},
        bass="picked", bass_line="r-t-f-6-s-6-f-t-", keys="piano", comp="..x...x...x...x.",
        lead="harmonica", rhythm="even8", legato=True),
    "ambient": dict(
        bpm=70, key=2, scale="major", prog=[(0, "maj7"), (7, "sus"), (9, "m7"), (5, "maj7")],
        drums={"shaker": "x...g...x...g...", "rim": "..............g."},
        bass="sub", bass_line="r---------------", keys="pad", comp="x---------------",
        lead="bell", rhythm="long", legato=True, lead_range=(69, 86)),
    "disco": dict(
        bpm=120, key=9, scale="dorian", prog=[(0, "m7"), (5, "7"), (0, "m7"), (5, "7")],
        drums={"kick": "x...x...x...x...", "snare": "....x.......x...", "hat": "x.x.x.x.x.x.x.x.",
               "ohat": "..x...x...x...x."},
        crash=True, bass="picked", bass_line="r-o-r-o-r-o-r-o-", keys="strings", comp="x-----..x-......",
        lead="voice:i", rhythm="syncop", legato=True),
    "indian_classical": dict(
        bpm=90, key=2, scale="bhairav", prog=[(0, "5")],
        drums={"tabla_lo": "x..x....x..x....", "tabla_hi": "x.xxgx.xx.xxgx.x"},
        bass="drone", bass_line="f---o---o---r---", keys="sitar", keys_low=50, comp="0...2.1.0...2.1.",
        lead="bansuri", rhythm="even8", legato=True, lead_range=(62, 81)),
    "lofi": dict(
        bpm=80, key=0, scale="major", swing=(0.5, 16), prog=[(0, "maj7"), (9, "m7"), (2, "m7"), (7, "7")],
        drums={"kick": "x......x..x.....", "snare": "....x.......x...", "hat": "x.x.x.x.x.x.x.x."},
        bass="sub", bass_line="r-----r...f-----", keys="rhodes", comp="x-------..x-----",
        lead="pluck", rhythm="sparse", legato=False, lowpass={"drums": 3500, "keys": 2200, "vocals": 3000},
        crackle=True),
    "techno": dict(
        bpm=130, key=9, scale="phrygian", prog=[(0, "min")],
        drums={"kick": "x...x...x...x...", "clap": "....x.......x...", "ohat": "..x...x...x...x.",
               "rim": "...x..x....x.x.."},
        bass="acid", bass_line="rrorrfrrorrsrror", keys="saw", comp="..x..x....x..x..",
        lead="synth", rhythm="sparse", legato=True),
    "country": dict(
        bpm=112, key=7, scale="pent_major", prog=[(0, "maj"), (5, "maj"), (7, "maj"), (0, "maj")],
        drums={"kick": "x.......x.......", "snare": "....x.......x...", "hat": "x.x.x.x.x.x.x.x."},
        bass="picked", bass_line="r---f---r---f---", keys="guitar", comp="x.x.x.x.x.x.x.x.",
        lead="fiddle", rhythm="even8", legato=True),
    "dubstep": dict(
        bpm=140, key=5, scale="minor", prog=[(0, "min"), (0, "min"), (8, "maj"), (7, "maj")],
        drums={"kick": "x.........x.....", "snare": "........X.......", "clap": "........x.......",
               "hat": "x.x.x.x.x.x.x.x."},
        bass="wobble", bass_line="r-------r---r-r-", keys="pad", comp="x---------------",
        lead="synth", rhythm="sparse", legato=True),
    "afrobeats": dict(
        bpm=104, key=2, scale="major", prog=[(0, "maj7"), (9, "m7"), (2, "m7"), (7, "maj")],
        drums={"kick": "x..x..x...x..x..", "rim": "...x..x....x..x.", "shaker": "xgxgxgxgxgxgxgxg",
               "conga": "..x.x..x..x.x..x", "clap": "....x.......x..."},
        bass="sub", bass_line="r..r..r.r..r..r.", keys="marimba", comp="0.1.2..1.0.2.1..",
        lead="voice:o", rhythm="syncop", legato=True),
    "jazz": dict(
        bpm=140, key=5, scale="major", swing=(1.0, 8), prog=[(2, "m7"), (7, "7"), (0, "maj7"), (0, "maj7")],
        drums={"ride": "x...x.x.x...x.x.", "hat": "....x.......x...", "snare": "g.....g....g....",
               "kick": "g..............."},
        bass="upright", bass_line="walk", keys="piano", comp="...x-.....x-....",
        lead="sax", rhythm="even8", legato=True, lead_range=(58, 77)),
    "reggae": dict(
        bpm=80, key=9, scale="minor", swing=(0.3, 16), prog=[(0, "min"), (0, "min"), (5, "min"), (5, "min")],
        drums={"kick": "........x.......", "rim": "........x.......", "hat": "x.x.x.x.x.x.x.x."},
        bass="sub", bass_line="r---..r.f-o-r-..", keys="skank", comp="..x...x...x...x.",
        lead="melodica", rhythm="sparse", legato=True),
    "funk": dict(
        bpm=104, key=4, scale="dorian", prog=[(0, "9"), (0, "9"), (5, "9"), (0, "9")],
        drums={"kick": "x..x..x...x.....", "snare": "....x..g.g..x..g", "hat": "xgxgxgxgxgxgxgxg"},
        bass="picked", bass_line="r..o.r.o.f..r-o.", keys="muted", comp="x.xx.x.xx.x.xx.x",
        lead="brass", rhythm="syncop", legato=False),
    "rnb": dict(
        bpm=72, key=0, scale="minor", swing=(0.3, 16), prog=[(0, "m7"), (8, "maj7"), (5, "m7"), (7, "7")],
        drums={"kick": "x......x..x.....", "snare": "....x.......x...", "hat": "x.x.x.xxx.x.x.x."},
        bass="sub", bass_line="r------.r---f---", keys="rhodes", comp="x-------x-------",
        lead="voice:u", rhythm="busy", legato=True),
    "trap": dict(
        bpm=140, key=5, scale="minor", prog=[(0, "min"), (8, "maj"), (5, "min"), (7, "maj")],
        drums={"kick": "x......x..x.....", "clap": "........x.......", "hat": "x.x.xxx.x.x.xxxx"},
        bass="808", bass_line="r------.r-.r----", keys="bell", comp="0...2...1...2...",
        lead="flute", rhythm="syncop", legato=True),
    "folk": dict(
        bpm=132, beats=3, key=7, scale="major", prog=[(0, "maj"), (5, "maj"), (0, "maj"), (7, "maj")],
        drums={"kick": "x...........", "shaker": "....x...x..."},
        bass="upright", bass_line="r-------f---", keys="guitar", comp="0.1.2.1.2.1.",
        lead="whistle", rhythm="even8", legato=True, lead_range=(67, 84)),
    "bossa_nova": dict(
        bpm=130, key=5, scale="major", prog=[(0, "maj7"), (2, "7"), (2, "m7"), (7, "7")],
        drums={"rim": "x..x..x...x..x..", "shaker": "xgxgxgxgxgxgxgxg", "kick": "g..gg..gg..gg..g"},
        bass="upright", bass_line="r--f----r--f----", keys="nylon", comp="x..x..x...x..x..",
        lead="voice:u", rhythm="sparse", legato=True),
    "hip_hop": dict(
        bpm=90, key=9, scale="minor", swing=(0.5, 16), prog=[(0, "m7"), (5, "m7"), (0, "m7"), (10, "maj7")],
        drums={"kick": "x......xx.x.....", "snare": "....x.......x...", "hat": "x.x.x.x.x.x.x.x."},
        bass="sub", bass_line="r-------..r.f---", keys="piano", comp="x--.x-....x--...",
        lead="strings", rhythm="sparse", legato=True, lowpass={"keys": 2500}),
    "classical_waltz": dict(
        bpm=150, beats=3, key=2, scale="major", prog=[(0, "maj"), (7, "7"), (7, "7"), (0, "maj")],
        drums={"timp": "x..........."},
        bass="cello", bass_line="r---........", keys="strings", comp="....x-..x-..",
        lead="violin", rhythm="even8", legato=True, lead_range=(64, 86)),
    "punk": dict(
        bpm=172, key=7, scale="major", prog=[(0, "5"), (5, "5"), (7, "5"), (0, "5")],
        drums={"kick": "x.x...x.x.x...x.", "snare": "....x.......x...", "hat": "x.x.x.x.x.x.x.x."},
        crash=True, fill=True, bass="picked", bass_line="r-r-r-r-r-r-r-r-", keys="dist", keys_low=43,
        comp="x-x-x-x-x-x-x-x-", lead="voice:a", rhythm="even8", legato=False, lead_range=(62, 79)),
    "ska": dict(
        bpm=160, key=2, scale="major", prog=[(0, "maj"), (9, "min"), (2, "min"), (7, "maj")],
        drums={"kick": "x.......x.......", "snare": "....x.......x...", "hat": "x.x.x.x.x.x.x.x."},
        bass="upright", bass_line="walk", keys="skank", comp="..x-..x-..x-..x-",
        lead="brass", rhythm="syncop", legato=False),
    "gospel": dict(
        bpm=76, key=5, scale="major", swing=(0.4, 16), prog=[(0, "maj7"), (5, "maj7"), (9, "m7"), (7, "7")],
        drums={"kick": "x.....x...x.....", "snare": "....x.......x...", "clap": "....x.......x...",
               "hat": "x.x.x.x.x.x.x.x."},
        bass="sub", bass_line="r-------f---r---", keys="choir:o", comp="x---------------",
        lead="voice:a", rhythm="syncop", legato=True),
    "soul": dict(
        bpm=108, key=0, scale="major", prog=[(0, "maj"), (9, "min"), (5, "maj"), (7, "maj")],
        drums={"kick": "x..x..x...x..x..", "snare": "x...x...x...x...", "tamb": "....x.......x..."},
        bass="picked", bass_line="r--r-f-6r--r-f-o", keys="piano", comp="x.x.x.x.x.x.x.x.",
        lead="voice:o", rhythm="syncop", legato=True),
    "trance": dict(
        bpm=138, key=9, scale="minor", prog=[(0, "min"), (5, "min"), (8, "maj"), (10, "maj")],
        drums={"kick": "x...x...x...x...", "clap": "....x.......x...", "ohat": "..x...x...x...x.",
               "hat": "gggggggggggggggg"},
        crash=True, bass="synth_bass", bass_line=".rrr.rrr.rrr.rrr", keys="saw", keys_low=57,
        comp="0123012301230123", lead="synth", rhythm="long", legato=True, lead_range=(64, 84)),
    "chiptune": dict(
        bpm=150, key=0, scale="major", prog=[(0, "maj"), (5, "maj"), (7, "maj"), (9, "min")],
        drums={"kick": "x.......x.......", "snare": "....x.......x...", "hat": "x.x.x.x.x.x.x.x."},
        bass="chip_bass", bass_line="r-o-r-o-r-o-r-o-", keys="chip", keys_low=60, comp="0121012101210121",
        lead="square", rhythm="busy", legato=False, lead_range=(67, 86)),
    "samba": dict(
        bpm=100, key=7, scale="major", prog=[(0, "maj"), (2, "m7"), (7, "7"), (0, "maj")],
        drums={"surdo": "x.......X.......", "shaker": "xgxgxgxgxgxgxgxg", "rim": "x.xx.x.xx.x.x.x.",
               "cowbell": "x..x..x...x.x..."},
        bass="picked", bass_line="r------.f------.", keys="nylon", comp="x.xx.x.x.xx.x.x.",
        lead="voice:a", rhythm="syncop", legato=True),
    "salsa": dict(
        bpm=95, key=9, scale="minor", prog=[(0, "min"), (5, "min"), (7, "7"), (0, "min")],
        drums={"cowbell": "x...x...x...x...", "clave": "x..x...x..x.x...", "conga": "..xx..x...xx..x."},
        bass="picked", bass_line="...r--.f...r--.f", keys="piano", comp="0.2.1.2.0.2.1.21",
        lead="brass", rhythm="syncop", legato=False),
    "tango": dict(
        bpm=120, key=2, scale="harmonic_minor", prog=[(0, "min"), (7, "7"), (7, "7"), (0, "min")],
        drums={"rim": "X...x...x.x.X..."},
        bass="upright", bass_line="r---f---r---f-r-", keys="accordion", comp="x-..x-..x-..x.x.",
        lead="violin", rhythm="even8", legato=True),
    "flamenco": dict(
        bpm=120, beats=3, key=4, scale="hijaz", prog=[(5, "min"), (3, "maj"), (1, "maj"), (0, "maj")],
        drums={"clap": "x..x..x.x.x.", "rim": "......x....."},
        bass="upright", bass_line="r-----r-----", keys="nylon", comp="xxx.x.x.xxx.",
        lead="voice:a", rhythm="even8", legato=True),
    "celtic": dict(
        bpm=180, beats=3, key=2, scale="major", prog=[(0, "maj"), (0, "maj"), (7, "maj"), (0, "maj")],
        drums={"bodhran": "X.x.x.X.x.x."},
        bass="upright", bass_line="r-----f-----", keys="guitar", comp="x...x.x...x.",
        lead="fiddle", rhythm="even8", legato=False, lead_range=(62, 81)),
    "bluegrass": dict(
        bpm=120, key=9, scale="pent_major", prog=[(0, "maj"), (0, "maj"), (5, "maj"), (7, "maj")],
        drums={"snare": "....g.......g..."},
        bass="upright", bass_line="r---f---r---f---", keys="muted", comp="....x.......x...",
        lead="banjo", rhythm="busy", legato=False, lead_range=(62, 81)),
    "bhangra": dict(
        bpm=100, key=2, scale="mixolydian", swing=(0.6, 8), prog=[(0, "maj"), (0, "maj"), (10, "maj"), (0, "maj")],
        drums={"dhol_lo": "x.....x.x.....x.", "dhol_hi": "..x.x...x.x.x...", "clap": "....x.......x..."},
        bass="sub", bass_line="r..r..r.r..r..r.", keys="tumbi", keys_low=62, comp="0.0.2.0.0.0.2.1.",
        lead="voice:a", rhythm="syncop", legato=True),
    "k_pop": dict(
        bpm=124, key=4, scale="major", prog=[(5, "maj7"), (7, "maj"), (4, "m7"), (9, "min")],
        drums={"kick": "x...x...x...x...", "clap": "....x.......x...", "hat": "x.xxx.x.x.xxx.x."},
        crash=True, bass="synth_bass", bass_line="r.r.r..rr.r.r..r", keys="saw", comp="x..x..x.x..x..x.",
        lead="voice:i", rhythm="busy", legato=True),
    "arabic": dict(
        bpm=100, key=2, scale="hijaz", prog=[(0, "5")],
        drums={"darbuka_lo": "x.......x.......", "darbuka_hi": "..x...x.....x.g."},
        bass="drone", bass_line="r---------------", keys="oud", comp="0.2.1.2.0.2.1.2.",
        lead="ney", rhythm="even8", legato=True),
    "march": dict(
        bpm=116, key=10, scale="major", prog=[(0, "maj"), (5, "maj"), (7, "7"), (0, "maj")],
        drums={"kick": "x...x...x...x...", "snare": "x..gx.x.x..gx.x."},
        crash=True, bass="tuba", bass_line="r---f---r---f---", keys="brass", comp="..x-..x-..x-..x-",
        lead="trumpet", rhythm="even8", legato=False),
    "swing": dict(
        bpm=160, key=3, scale="major", swing=(1.0, 8), prog=[(0, "maj7"), (9, "m7"), (2, "m7"), (7, "7")],
        drums={"ride": "x...x.x.x...x.x.", "hat": "....x.......x...", "kick": "g...g...g...g..."},
        bass="upright", bass_line="walk", keys="brass", comp="..x-......x-....",
        lead="clarinet", rhythm="even8", legato=True, lead_range=(62, 81)),
    "dancehall": dict(
        bpm=100, key=9, scale="minor", prog=[(0, "min"), (5, "min"), (7, "min"), (5, "min")],
        drums={"kick": "x..x....x..x....", "snare": "....x.......x...", "rim": "..x..x..x..x..x.",
               "hat": "x.x.x.x.x.x.x.x."},
        bass="sub", bass_line="r..r....r..r....", keys="synth_pluck", comp="..x...x...x..x..",
        lead="voice:e", rhythm="syncop", legato=True),
    "polka": dict(
        bpm=120, key=0, scale="major", prog=[(0, "maj"), (7, "7"), (7, "7"), (0, "maj")],
        drums={"kick": "x...x...x...x...", "snare": "..x...x...x...x."},
        bass="tuba", bass_line="r---f---r---f---", keys="accordion", comp="..x-..x-..x-..x-",
        lead="clarinet", rhythm="busy", legato=False),
    "baroque": dict(
        bpm=100, key=7, scale="major", prog=[(0, "maj"), (5, "maj"), (7, "7"), (0, "maj")],
        drums={},
        bass="cello", bass_line="r-o-f-o-r-o-t-o-", keys="harpsichord", comp="0121012101210121",
        lead="violin", rhythm="busy", legato=False, lead_range=(67, 86)),
    "gamelan": dict(
        bpm=90, key=0, scale="pelog", prog=[(0, "5")],
        drums={"gong": "x...............", "conga": "x.x..x.xx.x..x.."},
        bass="metallo", bass_line="r---f---o---f---", keys="metallo", keys_low=60, comp="0.1.2.1.0.1.2.1.",
        lead="bell", rhythm="even8", legato=False, lead_range=(67, 86)),
    "calypso": dict(
        bpm=110, key=0, scale="major", prog=[(0, "maj"), (5, "maj"), (7, "7"), (0, "maj")],
        drums={"kick": "x..x....x..x....", "rim": "....x.......x...", "shaker": "xgxgxgxgxgxgxgxg",
               "cowbell": "x...x...x...x..."},
        bass="picked", bass_line="r..r..f.r..r..f.", keys="guitar", comp="x.xx.xx.x.xx.xx.",
        lead="steel", rhythm="syncop", legato=False, lead_range=(64, 84)),
}

DEMOS = {
    "Demo Tune Alpha": "pop",
    "Demo Tune Beta": "house",
    "Crimson Skyline": "rock",
    "Neon Harbor": "synthwave",
    "Velvet Thunder": "metal",
    "Paper Planets": "drum_and_bass",
    "Midnight Arcade": "reggaeton",
    "Copper Rain": "blues",
    "Glass Garden": "ambient",
    "Lunar Parade": "disco",
    "Saffron Static": "indian_classical",
    "Ocean Telephone": "lofi",
    "Firefly Circuit": "techno",
    "Hollow Mountain": "country",
    "Electric Monsoon": "dubstep",
    "Lantern Festival": "afrobeats",
    "Silver Compass": "jazz",
    "Cobalt Sunrise": "reggae",
    "Desert Radio": "funk",
    "Marble Hearts": "rnb",
    "Static Bloom": "trap",
    "Northern Echo": "folk",
    "Tangerine Drive": "bossa_nova",
    "Quiet Volcano": "hip_hop",
    "Satellite Waltz": "classical_waltz",
    "Broken Antenna": "punk",
    "Checkered Sunday": "ska",
    "Morning Choir": "gospel",
    "Honey Avenue": "soul",
    "Infinite Horizon": "trance",
    "Pixel Kingdom": "chiptune",
    "Carnival Feathers": "samba",
    "Mango Street": "salsa",
    "Velvet Rose": "tango",
    "Andalusian Dust": "flamenco",
    "Emerald Hills": "celtic",
    "Rusty Porch": "bluegrass",
    "Golden Fields": "bhangra",
    "Starlight Signal": "k_pop",
    "Silk Road Nights": "arabic",
    "Iron Regiment": "march",
    "Ballroom Lights": "swing",
    "Island Pulse": "dancehall",
    "Village Dance": "polka",
    "Candle Sonata": "baroque",
    "Temple Bells": "gamelan",
    "Coconut Breeze": "calypso",
}

# Each style's filter genre, named like the hits library's genres so the filters read the same.
FILTER_GENRES = {
    "Pop": ["pop", "k_pop"],
    "Rock": ["rock", "metal", "punk"],
    "Hip-Hop/Rap": ["hip_hop", "trap", "lofi"],
    "Dance/Electronic": ["house", "synthwave", "drum_and_bass", "disco", "techno", "dubstep", "trance",
                         "chiptune", "ambient"],
    "R&B/Soul": ["rnb", "soul", "gospel", "funk", "blues"],
    "Jazz/Classical": ["jazz", "swing", "classical_waltz", "baroque", "march"],
    "Latin": ["reggaeton", "bossa_nova", "samba", "salsa", "tango", "flamenco"],
    "Reggae/Afro": ["reggae", "ska", "dancehall", "afrobeats", "calypso"],
    "Country": ["country", "bluegrass", "folk"],
    "Indian": ["indian_classical", "bhangra"],
    "World": ["celtic", "arabic", "polka", "gamelan"],
}
GENRE_OF = {style: genre for genre, styles in FILTER_GENRES.items() for style in styles}

# ---------------------------------------------------------------- instruments

SAW = [1 / k for k in range(1, 17)]
SQUARE = [1 / k if k % 2 else 0 for k in range(1, 17)]
ORGAN = [1, 0.9, 0.6, 0.5, 0, 0.35, 0, 0.25]
FORMANTS = {"a": (730, 1090, 2440), "e": (530, 1840, 2480), "i": (270, 2290, 3010),
            "o": (570, 840, 2410), "u": (300, 870, 2240)}

INSTRUMENTS = {
    # bass
    "sub": dict(amps=[1, 0.2], attack=0.005, decay=1.5, sustain=0.7, release=0.06),
    "808": dict(amps=[1, 0.1], attack=0.003, decay=0.8, sustain=0.4, release=0.1, drive=2, glide=0.08),
    "synth_bass": dict(amps=SAW, attack=0.004, decay=6, sustain=0.5, release=0.04, cutoff=500, fenv=3, fdecay=15),
    "picked": dict(amps=[1, 0.5, 0.35, 0.2, 0.15, 0.1], attack=0.003, decay=3, sustain=0.35, release=0.05),
    "dist_bass": dict(amps=SAW, attack=0.003, decay=2, sustain=0.7, release=0.04, drive=3, cutoff=900),
    "reese": dict(amps=SAW, detune=1.012, attack=0.02, release=0.08, cutoff=450),
    "wobble": dict(amps=SAW, detune=1.008, attack=0.005, release=0.05, cutoff=250, wobble=2, drive=2),
    "acid": dict(amps=SAW, attack=0.003, decay=5, sustain=0.4, release=0.03, cutoff=300, fenv=8, fdecay=10,
                 drive=1.5),
    "drone": dict(amps=[1, 0.7, 0.5, 0.45, 0.3, 0.25, 0.2, 0.15], attack=0.25, decay=0.6, sustain=0.5,
                  release=1.5, tremolo=(0.7, 0.2)),
    "cello": dict(amps=SAW, attack=0.08, release=0.15, cutoff=1100, vibrato=(5, 0.005, 0.2)),
    "upright": dict(pluck=0.985, bright=0.3, release=0.05, cutoff=700),
    # keys
    "piano": dict(amps=[1, 0.6, 0.35, 0.25, 0.15, 0.1, 0.07, 0.05], attack=0.003, decay=2.5, sustain=0.08,
                  release=0.12),
    "organ": dict(amps=ORGAN, attack=0.01, release=0.05, tremolo=(6, 0.12)),
    "skank": dict(amps=ORGAN, attack=0.003, decay=14, sustain=0, release=0.03),
    "rhodes": dict(amps=[1, 0.3, 0.1, 0, 0, 0, 0, 0.05], attack=0.003, decay=1.2, sustain=0.25, release=0.2,
                   tremolo=(4.5, 0.25)),
    "pad": dict(amps=SAW, detune=1.007, attack=0.5, release=0.5, cutoff=1300),
    "strings": dict(amps=SAW, detune=1.005, attack=0.18, release=0.25, cutoff=2200, vibrato=(5.5, 0.004, 0.15)),
    "saw": dict(amps=SAW, detune=1.01, attack=0.003, decay=9, sustain=0.05, release=0.05, cutoff=1200, fenv=2,
                fdecay=12),
    "dist": dict(amps=SAW, detune=1.006, attack=0.003, decay=1.5, sustain=0.6, release=0.04, drive=5, cutoff=2600),
    "marimba": dict(amps=[1, 0, 0, 0.25, 0, 0, 0, 0, 0, 0.06], attack=0.002, decay=9, sustain=0, release=0.03),
    "bell": dict(amps=[1, 0, 0.45, 0, 0.3, 0, 0, 0.15, 0, 0.08], attack=0.002, decay=2, sustain=0, release=0.3),
    "guitar": dict(pluck=0.996, bright=0.8, release=0.05),
    "nylon": dict(pluck=0.994, bright=0.45, release=0.06),
    "muted": dict(pluck=0.97, bright=0.6, release=0.02),
    "sitar": dict(pluck=0.998, bright=0.9, buzz=0.4, release=0.1),
    # leads
    "voice": dict(attack=0.06, release=0.08, vibrato=(5.5, 0.006, 0.18), glide=0.05),
    "flute": dict(amps=[1, 0.2, 0.07, 0.03], breath=0.06, attack=0.05, release=0.06, vibrato=(5, 0.005, 0.2),
                  glide=0.02),
    "whistle": dict(amps=[1, 0.06], breath=0.03, attack=0.02, release=0.04, vibrato=(6, 0.006, 0.12), glide=0.03),
    "bansuri": dict(amps=[1, 0.25, 0.08], breath=0.1, attack=0.07, release=0.1, vibrato=(4.5, 0.008, 0.3),
                    glide=0.12),
    "sax": dict(amps=[1, 0.8, 0.75, 0.55, 0.45, 0.35, 0.25, 0.18, 0.12, 0.08], attack=0.04, release=0.06,
                vibrato=(5, 0.006, 0.25), drive=1.5, cutoff=2600, glide=0.03),
    "harmonica": dict(amps=[1, 0.5, 0.6, 0.3, 0.45, 0.2, 0.25, 0.1], attack=0.03, release=0.05,
                      vibrato=(6, 0.012, 0.12), glide=0.07, drive=1.3),
    "melodica": dict(amps=[1, 0.45, 0.55, 0.25, 0.35, 0.15, 0.2], attack=0.02, release=0.05,
                     vibrato=(5, 0.003, 0.3)),
    "brass": dict(amps=SAW, attack=0.03, decay=4, sustain=0.6, release=0.06, cutoff=1500, fenv=-0.7, fdecay=15,
                  drive=1.3),
    "synth": dict(amps=SAW, detune=1.006, attack=0.01, release=0.1, cutoff=2500, vibrato=(5.5, 0.004, 0.3),
                  glide=0.04),
    "square": dict(amps=SQUARE, attack=0.01, release=0.1, cutoff=3500, vibrato=(6, 0.005, 0.25)),
    "violin": dict(amps=SAW, attack=0.06, release=0.1, cutoff=2800, vibrato=(6, 0.007, 0.12), glide=0.03),
    "fiddle": dict(amps=SAW, attack=0.03, release=0.05, cutoff=3200, vibrato=(6.5, 0.006, 0.1), glide=0.04),
    "guitar_lead": dict(amps=SAW, attack=0.005, decay=1, sustain=0.7, release=0.05, drive=6, cutoff=3000,
                        vibrato=(5.5, 0.008, 0.2), glide=0.03),
    "pluck": dict(pluck=0.995, bright=0.7, release=0.05),
    # more bass, keys and leads
    "chip_bass": dict(amps=[1, 0, 1 / 9, 0, 1 / 25, 0, 1 / 49], attack=0.002, release=0.02),
    "tuba": dict(amps=SAW, attack=0.03, decay=3, sustain=0.6, release=0.05, cutoff=500),
    "metallo": dict(amps=[1, 0, 0, 0.3, 0, 0, 0, 0, 0.12], attack=0.002, decay=1.2, sustain=0, release=0.4),
    "accordion": dict(amps=[1, 0.7, 0.6, 0.45, 0.35, 0.25, 0.2, 0.15, 0.1], detune=1.004, attack=0.02,
                      release=0.05, tremolo=(5.5, 0.08)),
    "choir": dict(attack=0.25, release=0.3, vibrato=(5, 0.005, 0.1)),
    "chip": dict(amps=SQUARE, attack=0.002, decay=6, sustain=0.3, release=0.02),
    "synth_pluck": dict(amps=SAW, attack=0.002, decay=10, sustain=0, release=0.05, cutoff=900, fenv=4, fdecay=18),
    "harpsichord": dict(pluck=0.993, bright=1.0, release=0.04),
    "oud": dict(pluck=0.99, bright=0.65, buzz=0.15, release=0.06),
    "tumbi": dict(pluck=0.985, bright=0.95, buzz=0.2, release=0.04),
    "banjo": dict(pluck=0.98, bright=1.0, release=0.03),
    "steel": dict(amps=[1, 0, 0, 0.35, 0, 0.15, 0, 0, 0.1], attack=0.002, decay=3.5, sustain=0, release=0.1),
    "trumpet": dict(amps=SAW, attack=0.02, release=0.05, cutoff=2600, fenv=-0.6, fdecay=20, drive=1.2,
                    vibrato=(5.5, 0.005, 0.25)),
    "clarinet": dict(amps=[1, 0, 0.45, 0, 0.3, 0, 0.18, 0, 0.1], attack=0.03, release=0.06,
                     vibrato=(5, 0.004, 0.3), glide=0.02),
    "ney": dict(amps=[1, 0.2, 0.06], breath=0.18, attack=0.08, release=0.1, vibrato=(4.5, 0.009, 0.25), glide=0.1),
}

_tables: dict[tuple, list[float]] = {}


def wavetable(amps) -> list[float]:
    key = tuple(round(a, 4) for a in amps)
    if key not in _tables:
        size = 1024
        table = [sum(a * math.sin(TAU * k * i / size) for k, a in enumerate(key, 1) if a) for i in range(size)]
        peak = max(abs(v) for v in table) or 1
        _tables[key] = [v / peak for v in table]
    return _tables[key]


def vowel_amps(vowel: str, freq: float) -> list[float]:
    amps = []
    for k in range(1, 25):
        h = k * freq
        if h > RATE / 2 - 500:
            break
        amps.append(0.08 / k + sum(g * math.exp(-(((h - f) / (100 + 0.1 * f)) ** 2))
                                   for f, g in zip(FORMANTS[vowel], (1, 0.6, 0.3))))
    return amps


def lowpass(samples: list[float], cutoff: float) -> list[float]:
    a = 1 - math.exp(-TAU * min(cutoff, RATE * 0.45) / RATE)
    y1 = y2 = 0.0
    out = []
    for s in samples:
        y1 += a * (s - y1)
        y2 += a * (y1 - y2)
        out.append(y2)
    return out


def pluck(p: dict, freq: float, dur: float, rng: random.Random) -> list[float]:
    """Karplus-Strong plucked string."""
    period = max(2, round(RATE / freq - 0.5))
    bright, y, buf = p.get("bright", 0.6), 0.0, []
    for _ in range(period):
        y += bright * (rng.uniform(-1, 1) - y)
        buf.append(y)
    mean = sum(buf) / period
    peak = max(abs(v - mean) for v in buf) or 1
    buf = [(v - mean) / peak for v in buf]
    release, damp, buzz = p.get("release", 0.05), p["pluck"], p.get("buzz", 0)
    out = [0.0] * int((dur + release) * RATE)
    for i in range(len(out)):
        j = i % period
        v = buf[j]
        buf[j] = damp * 0.5 * (v + buf[(j + 1) % period])
        if buzz:
            v = v * (1 - buzz) + buzz * math.tanh(4 * v)
        t = i / RATE
        if t > dur:
            v *= max(0.0, 1 - (t - dur) / release)
        out[i] = v
    return lowpass(out, p["cutoff"]) if "cutoff" in p else out


def tone(p: dict, freq: float, dur: float, rng: random.Random, bpm: int, prev: float | None) -> list[float]:
    """Wavetable oscillator with envelope, vibrato, glide, drive and a (moving) low-pass filter."""
    table = wavetable(vowel_amps(p["vowel"], freq) if "vowel" in p else p["amps"])
    size = len(table)
    attack, decay, sustain = p.get("attack", 0.01), p.get("decay", 0), p.get("sustain", 1.0)
    release = p.get("release", 0.05)
    vib, trem, detune = p.get("vibrato"), p.get("tremolo"), p.get("detune")
    glide = p.get("glide") if prev and prev != freq else None
    drive, breath = p.get("drive"), p.get("breath", 0)
    cutoff, fenv, fdecay = p.get("cutoff"), p.get("fenv", 0), p.get("fdecay", 1)
    wobble_rate = p["wobble"] * bpm / 60 if "wobble" in p else 0
    fixed_a = 1 - math.exp(-TAU * min(cutoff, RATE * 0.45) / RATE) if cutoff else 0
    out = [0.0] * int((dur + release) * RATE)
    ph = ph2 = y1 = y2 = 0.0
    for i in range(len(out)):
        t = i / RATE
        f = prev * (freq / prev) ** (t / glide) if glide and t < glide else freq
        if vib and t > vib[2]:
            f *= 1 + vib[1] * math.sin(TAU * vib[0] * t)
        ph += f / RATE
        ph -= int(ph)
        s = table[int(ph * size)]
        if detune:
            ph2 += f * detune / RATE
            ph2 -= int(ph2)
            s = (s + table[int(ph2 * size)]) * 0.5
        if breath:
            s += breath * rng.uniform(-1, 1)
        if drive:
            s = math.tanh(drive * s)
        if cutoff:
            a = fixed_a
            if fenv or wobble_rate:
                fc = cutoff * (1 + fenv * math.exp(-t * fdecay))
                if wobble_rate:
                    fc *= 1 + 6 * (0.5 - 0.5 * math.cos(TAU * wobble_rate * t))
                a = 1 - math.exp(-TAU * min(max(fc, 20), RATE * 0.45) / RATE)
            y1 += a * (s - y1)
            y2 += a * (y1 - y2)
            s = y2
        if t < attack:
            e = t / attack
        elif decay:
            e = sustain + (1 - sustain) * math.exp(-(t - attack) * decay)
        else:
            e = 1.0
        if t > dur:
            e *= max(0.0, 1 - (t - dur) / release)
        if trem:
            e *= 1 - trem[1] * (0.5 + 0.5 * math.sin(TAU * trem[0] * t))
        out[i] = s * e
    return out


def instrument(name: str) -> dict:
    base, _, vowel = name.partition(":")
    return dict(INSTRUMENTS[base], vowel=vowel) if vowel else INSTRUMENTS[base]


def drum(name: str, rng: random.Random) -> list[float]:
    def times(seconds):
        return [i / RATE for i in range(int(seconds * RATE))]

    def hp_noise(n):
        prev, out = 0.0, []
        for _ in range(n):
            v = rng.uniform(-1, 1)
            out.append((v - prev) * 0.5)
            prev = v
        return out

    if name == "kick":
        out, ph = [], 0.0
        for t in times(0.4):
            ph += (45 + 110 * math.exp(-t * 35)) / RATE
            out.append(math.sin(TAU * ph) * math.exp(-t * 8) + (rng.uniform(-0.3, 0.3) if t < 0.003 else 0))
        return out
    if name == "snare":
        return [0.55 * rng.uniform(-1, 1) * math.exp(-t * 20) + 0.5 * math.sin(TAU * 185 * t) * math.exp(-t * 30)
                for t in times(0.25)]
    if name == "clap":
        ts = times(0.25)
        return [n * (max(math.exp(-(t - o) * 120) if t >= o else 0 for o in (0, 0.012, 0.024))
                     + (0.6 * math.exp(-(t - 0.03) * 18) if t > 0.03 else 0))
                for n, t in zip(hp_noise(len(ts)), ts)]
    if name == "rim":
        return [(math.sin(TAU * 820 * t) + 0.6 * math.sin(TAU * 1650 * t)) * 0.6 * math.exp(-t * 70)
                + 0.3 * rng.uniform(-1, 1) * math.exp(-t * 200) for t in times(0.08)]
    if name in ("hat", "ohat", "shaker", "crash"):
        seconds, rate = {"hat": (0.05, 90), "ohat": (0.3, 9), "shaker": (0.08, 60), "crash": (1.4, 3)}[name]
        ts = times(seconds)
        attack = 0.01 if name == "shaker" else 0.0005
        return [n * (t / attack if t < attack else math.exp(-(t - attack) * rate))
                for n, t in zip(hp_noise(len(ts)), ts)]
    if name == "ride":
        ts = times(0.7)
        return [(0.3 * n + 0.1 * sum(math.sin(TAU * f * t) for f in (3150, 4420, 5870))) * math.exp(-t * 5)
                for n, t in zip(hp_noise(len(ts)), ts)]
    if name == "conga":
        out, ph = [], 0.0
        for t in times(0.3):
            ph += 330 * (1 + 0.3 * math.exp(-t * 40)) / RATE
            out.append(math.sin(TAU * ph) * math.exp(-t * 14))
        return out
    if name == "tabla_hi":
        return [(math.sin(TAU * 520 * t) + 0.5 * math.sin(TAU * 1046 * t)) * math.exp(-t * 7)
                + 0.3 * rng.uniform(-1, 1) * math.exp(-t * 150) for t in times(0.6)]
    if name == "tabla_lo":
        out, ph = [], 0.0
        for t in times(0.6):
            ph += 95 * (1 + 0.4 * (1 - math.exp(-t * 8))) / RATE
            out.append(math.sin(TAU * ph) * math.exp(-t * 5))
        return out
    if name == "timp":
        return [(math.sin(TAU * 73.4 * t) + 0.5 * math.sin(TAU * 110 * t) + 0.3 * math.sin(TAU * 146.8 * t))
                * math.exp(-t * 3) + 0.2 * rng.uniform(-1, 1) * math.exp(-t * 60) for t in times(1.2)]
    if name == "cowbell":
        return [(math.sin(TAU * 560 * t) + 0.7 * math.sin(TAU * 845 * t)) * 0.5 * math.exp(-t * 12)
                for t in times(0.3)]
    if name == "clave":
        return [math.sin(TAU * 2500 * t) * math.exp(-t * 60) for t in times(0.08)]
    if name == "tamb":
        ts = times(0.2)
        return [(0.6 * n + 0.2 * (math.sin(TAU * 5200 * t) + math.sin(TAU * 7300 * t))) * math.exp(-t * 25)
                for n, t in zip(hp_noise(len(ts)), ts)]
    if name in ("surdo", "dhol_lo", "darbuka_lo", "bodhran"):
        base, bend, rate, seconds = {"surdo": (70, 0.2, 4, 0.8), "dhol_lo": (80, 0.35, 6, 0.6),
                                     "darbuka_lo": (110, -0.25, 8, 0.5), "bodhran": (110, 0.3, 10, 0.35)}[name]
        out, ph = [], 0.0
        for t in times(seconds):
            ph += base * (1 + bend * math.exp(-t * 30)) / RATE
            out.append(math.sin(TAU * ph) * math.exp(-t * rate) + 0.2 * rng.uniform(-1, 1) * math.exp(-t * 40))
        return out
    if name in ("dhol_hi", "darbuka_hi"):
        pitch, seconds = (420, 0.15) if name == "dhol_hi" else (1200, 0.08)
        ts = times(seconds)
        return [0.6 * n * math.exp(-t * 80) + 0.5 * math.sin(TAU * pitch * t) * math.exp(-t * 40)
                for n, t in zip(hp_noise(len(ts)), ts)]
    if name == "gong":
        return [sum(a * math.sin(TAU * f * t) for f, a in ((65, 1), (98.7, 0.6), (131, 0.4), (167, 0.3)))
                * min(1.0, t / 0.02) * math.exp(-t * 1.2) for t in times(2.5)]
    raise ValueError(f"unknown drum: {name}")


# ---------------------------------------------------------------- arrangement


def midi_freq(midi: float) -> float:
    return 440 * 2 ** ((midi - 69) / 12)


def place(pitch_class: int, low: int) -> int:
    """Lowest MIDI note at or above `low` with this pitch class."""
    return low + (pitch_class - low) % 12


def layout(genre: dict) -> tuple[int, float, int]:
    """Steps (16ths) per bar, seconds per step, and bars (a multiple of 4, about TARGET_SECONDS long)."""
    steps_per_bar = genre.get("beats", 4) * 4
    step = 60 / genre["bpm"] / 4
    bars = max(4, 4 * round(TARGET_SECONDS / (4 * steps_per_bar * step)))
    return steps_per_bar, step, bars


def song_seconds(genre: dict) -> float:
    steps_per_bar, step, bars = layout(genre)
    return round(bars * steps_per_bar * step, 2)


def pattern_notes(pattern: str, total_steps: int) -> list[tuple[int, str, int]]:
    """(step, character, length in steps) for every onset in a repeating pattern."""
    notes = []
    for s in range(total_steps):
        ch = pattern[s % len(pattern)]
        if ch in "-.":
            continue
        length = 1
        while s + length < total_steps and pattern[(s + length) % len(pattern)] == "-":
            length += 1
        notes.append((s, ch, length))
    return notes


def make_melody(rng, genre, steps_per_bar, bars, chord) -> list[tuple[int, int, int]]:
    scale, key = SCALES[genre["scale"]], genre["key"]
    low, high = genre.get("lead_range", (62, 79))
    pool = [m for m in range(low, high + 1) if (m - key) % 12 in scale]
    odds = RHYTHMS[genre["rhythm"]]

    def bar_rhythm(ending=False):
        steps = [s for s in range(steps_per_bar) if rng.random() < odds[s % 4]]
        if ending:
            steps = [s for s in steps if s < steps_per_bar // 2]
        return sorted(set(steps) | {0}) if len(steps) < 2 else steps

    phrase_bars = 8 if len(genre["prog"]) == 8 and bars % 8 == 0 else 4
    a, b, c = bar_rhythm(), bar_rhythm(), bar_rhythm()
    rhythms = ([a, b, a, c, a, b, a] if phrase_bars == 8 else [a, b, a]) + [bar_rhythm(ending=True)]
    idx = min(range(len(pool)), key=lambda j: abs(pool[j] - (low + high) / 2))
    notes = []
    for bar, steps in enumerate(rhythms):
        pc, intervals = chord(bar)
        tones = {(pc + i) % 12 for i in intervals}
        for s in steps:
            options, weights = [], []
            for move, weight in ((0, 1), (1, 4), (-1, 4), (2, 2), (-2, 2), (3, 1), (-3, 1), (4, 0.5), (-4, 0.5)):
                j = idx + move
                if 0 <= j < len(pool):
                    options.append(j)
                    weights.append(weight * (4 if s % 4 == 0 and pool[j] % 12 in tones else 1))
            idx = rng.choices(options, weights)[0]
            notes.append([bar * steps_per_bar + s, pool[idx]])
    tonics = [j for j, m in enumerate(pool) if (m - key) % 12 == 0]
    notes[-1][1] = pool[min(tonics, key=lambda j: abs(j - idx))]
    phrase_steps = phrase_bars * steps_per_bar
    cap = 8 if genre["legato"] else 2
    events = []
    for k, (s, m) in enumerate(notes):
        nxt = notes[k + 1][0] if k + 1 < len(notes) else phrase_steps
        events.append((s, nxt - s if k + 1 == len(notes) else min(nxt - s, cap), m))
    return [(rep * phrase_steps + s, length, m) for rep in range(bars // phrase_bars) for s, length, m in events]


def render(title: str, genre: dict) -> dict[str, list[float]]:
    rng = random.Random(title)
    steps_per_bar, step, bars = layout(genre)
    total_steps = bars * steps_per_bar
    total = int(round(total_steps * step * RATE))
    stems = {name: [0.0] * total for name in STEM_NAMES}
    swing, swing_grid = genre.get("swing", (0, 8))
    bpm = genre["bpm"]

    def start(s: int) -> int:
        t = s * step
        if swing and swing_grid == 8 and s % 4 == 2:
            t += swing * step * 2 / 3
        if swing and swing_grid == 16 and s % 2 == 1:
            t += swing * step / 3
        return int(t * RATE)

    def mix(stem: str, s: int, samples: list[float], gain: float = 1.0) -> None:
        buf, at = stems[stem], start(s) % total
        for i, v in enumerate(samples):
            buf[(at + i) % total] += v * gain  # wraps around so the clip loops seamlessly

    def chord(bar: int) -> tuple[int, tuple[int, ...]]:
        offset, quality = genre["prog"][bar % len(genre["prog"])]
        return (genre["key"] + offset) % 12, QUALITIES[quality]

    cache: dict[tuple, list[float]] = {}

    def play(stem: str, name: str, s: int, length: int, midi: int, gain: float, prev: int | None = None) -> None:
        p = instrument(name)
        prev = prev if "glide" in p else None
        key = (name, midi, length, prev)
        if key not in cache:
            freq, dur = midi_freq(midi), length * step * 0.95
            prev_freq = midi_freq(prev) if prev is not None else None
            cache[key] = pluck(p, freq, dur, rng) if "pluck" in p else tone(p, freq, dur, rng, bpm, prev_freq)
        mix(stem, s, cache[key], gain)

    # drums
    hits: dict[str, list[float]] = {}

    def hit(voice: str, s: int, gain: float) -> None:
        if voice not in hits:
            hits[voice] = drum(voice, rng)
        mix("drums", s, hits[voice], gain)

    for voice, pattern in genre["drums"].items():
        for s in range(total_steps):
            ch = pattern[s % len(pattern)]
            if ch in VELOCITY:
                hit(voice, s, VELOCITY[ch])
    for bar in range(bars):
        if genre.get("crash") and bar % 4 == 0:
            hit("crash", bar * steps_per_bar, 0.6)
        if genre.get("fill") and bar % 4 == 3:
            for k in range(4):
                hit("snare", (bar + 1) * steps_per_bar - 4 + k, 0.45 + 0.12 * k)

    # bass
    bass_low = genre.get("bass_low", 33)
    bass_notes = []
    if genre["bass_line"] == "walk":
        scale = SCALES["major"]
        for bar in range(bars):
            pc, intervals = chord(bar)
            root = place(pc, bass_low)
            target = place(chord(bar + 1)[0], bass_low)
            walk = [root, root + rng.choice(intervals[1:3]), root + rng.choice((scale[1], scale[3], intervals[2])),
                    target + rng.choice((-1, 1))]
            bass_notes += [(bar * steps_per_bar + 4 * beat, 4, m) for beat, m in enumerate(walk)]
    else:
        for s, ch, length in pattern_notes(genre["bass_line"], total_steps):
            pc, intervals = chord(s // steps_per_bar)
            interval = intervals[1] if ch == "t" else BASS_STEPS[ch]
            bass_notes.append((s, length, place(pc, bass_low) + interval))
    prev = None
    for s, length, m in bass_notes:
        play("bass", genre["bass"], s, length, m, 1.0, prev)
        prev = m

    # keys
    keys_low = genre.get("keys_low", 52)
    for s, ch, length in pattern_notes(genre["comp"], total_steps):
        pc, intervals = chord(s // steps_per_bar)
        voicing = [place(pc, keys_low) + i for i in intervals]
        if ch == "x":
            for m in voicing:
                play("keys", genre["keys"], s, length, m, 1 / len(voicing) ** 0.5)
        else:
            d = int(ch)
            play("keys", genre["keys"], s, length, voicing[d % len(voicing)] + 12 * (d // len(voicing)), 1.0)

    # lead ("vocals" stem)
    prev, prev_end = None, None
    for s, length, m in make_melody(rng, genre, steps_per_bar, bars, chord):
        play("vocals", genre["lead"], s, length, m, 1.0, prev if prev_end is not None and s - prev_end <= 1 else None)
        prev, prev_end = m, s + length

    if genre.get("crackle"):
        drums = stems["drums"]
        for _ in range(int(total / RATE * 10)):
            at = rng.randrange(total)
            for i in range(4):
                drums[(at + i) % total] += rng.uniform(-0.15, 0.15)
    for stem, cutoff in genre.get("lowpass", {}).items():
        stems[stem] = lowpass(stems[stem], cutoff)
    for stem, target in {"drums": 0.55, "bass": 0.42, "keys": 0.32, "vocals": 0.34}.items():
        peak = max(abs(v) for v in stems[stem])
        if peak:
            stems[stem] = [v * target / peak for v in stems[stem]]
    return stems


# ---------------------------------------------------------------- files and database

DEMO_ROOT = config.MEDIA_DIR / "demo"
# Which random folder holds which song. Kept outside MEDIA_DIR because it maps folders to titles,
# so it must never be served.
INDEX_FILE = config.BASE_DIR / "demo_index.json"


def demo_dirs() -> dict[str, Path]:
    """Random folder per song (like processed songs), so stem URLs don't give the title away."""
    try:
        index = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        index = {}
    current = index.get("version") == VERSION
    folders = index.get("folders", {}) if current else {}
    if not current or set(folders) != set(DEMOS):
        folders = {title: folders.get(title) or secrets.token_hex(8) for title in DEMOS}
        INDEX_FILE.write_text(json.dumps({"version": VERSION, "folders": folders}, indent=2), encoding="utf-8")
    return {title: DEMO_ROOT / folder for title, folder in folders.items()}


def write_wav(path: Path, samples: list[float]) -> None:
    pcm = array("h", (int(max(-1.0, min(1.0, s)) * 32767) for s in samples))
    if sys.byteorder == "big":
        pcm.byteswap()
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())


def write_files() -> None:
    folders = demo_dirs()
    if DEMO_ROOT.exists():
        for old in DEMO_ROOT.iterdir():
            if old not in folders.values():
                shutil.rmtree(old, ignore_errors=True)
    for title, genre in DEMOS.items():
        folder = folders[title]
        # Every genre has a bass line, and it's written last, so it marks a finished song.
        if (folder / "bass.wav").exists():
            continue
        folder.mkdir(parents=True, exist_ok=True)
        stems = render(title, GENRES[genre])
        for name in sorted(stems, key=lambda n: n == "bass"):
            if any(stems[name]):  # e.g. baroque has no drums
                write_wav(folder / f"{name}.wav", stems[name])
        print(f"wrote: {title} ({genre})")


def register_songs() -> None:
    init_db()
    folders = demo_dirs()
    with SessionLocal() as db:
        current = {f"demo:{title}" for title in DEMOS}
        for old in db.scalars(select(Song).where(Song.source_file.startswith("demo:"))):
            if old.source_file not in current:
                db.delete(old)
                print(f"removed: {old.title}")
        for title, genre in DEMOS.items():
            source = f"demo:{title}"
            song = db.scalar(select(Song).where(Song.source_file == source))
            if song is None:
                song = Song(title=title, artist="Stem Guess", aliases=[], source_file=source)
                db.add(song)
                print(f"added: {title}")
            folder = folders[title].relative_to(config.MEDIA_DIR).as_posix()
            song.stems = [Stem(name=name, path=f"{folder}/{name}.wav") for name in STEM_NAMES
                          if (folders[title] / f"{name}.wav").exists()]
            song.duration = song_seconds(GENRES[genre])
            song.genre = GENRE_OF[genre]
        db.commit()


def main() -> None:
    write_files()
    if "--files-only" not in sys.argv:
        register_songs()


if __name__ == "__main__":
    main()
