# Stem Guess

Multiplayer "name that song" game: each round plays a song clip (all its stems together, looped)
and shows four titles. Every player gets one pick; a correct pick scores 10 points at the start of
the round, falling to 1 point at the buzzer. From halfway through a round, each player may remove up to two
wrong options for themselves only; their correct pick then scores ×0.5 (one removed) or ×0.2 (two removed),
rounded to one decimal (`REMOVE_AFTER`, `REMOVE_MULTIPLIERS`). A round ends when the countdown (30 s, `ROUND_SECONDS`)
runs out or everyone has answered, and the next one starts 5 s after the answer is shown
(`RESULT_SECONDS`). The host picks how many songs a game has (3-10) and the room's max player count (2-10).

| Part | Tech |
| --- | --- |
| `client/` | Vite + React + TypeScript, Socket.IO client, Web Audio. Wrapped by Capacitor for Android / desktop |
| `server/` | Python, FastAPI + python-socketio, SQLAlchemy. Also serves the built client |
| Database | PostgreSQL (SQLite fallback for local dev) |
| Stems | Music.ai API, run offline by `server/scripts/process_songs.py`, cached in `server/media/` |

Everything runs as **one server**: the Python app serves the web client, the stem audio and the
real-time game connection on the same port.

The Music.ai API key stays on the server. Songs are separated **once** and the stems are cached,
so a game never triggers a paid API call.

## Run locally

Prerequisites: Node 20+, Python 3.11+, optionally [ffmpeg](https://ffmpeg.org/) on PATH
(cuts stems to 15 s MP3s from the song's most energetic part and drops silent stems) and Docker (for local Postgres).

```powershell
powershell -ExecutionPolicy Bypass -File start.ps1
```

This builds the client, sets up the Python environment on first run and serves the app at
http://localhost:8000. Open it in two browser windows to play against yourself. Phones on the same
Wi-Fi can join via `http://<your-PC-IP>:8000` (allow Python through the Windows firewall).

For quick testing without Music.ai, add 47 synthetic demo songs, one per genre (pop, rock, jazz, hip-hop, reggae, Indian classical and more), from `server/`:
`.\.venv\Scripts\python -m scripts.seed_demo`

Without `DATABASE_URL` the server uses `server/stemguess.db` (SQLite). For Postgres:
`docker compose up -d` in the repo root and set
`DATABASE_URL=postgresql://stemguess:stemguess@localhost:5432/stemguess` in `server/.env`.

Optional hot-reload while editing the UI: keep the server running and run `npm run dev` in
`client/`, then open http://localhost:5173 (it proxies to the server).

## Add songs (Music.ai)

1. In the [Music.ai dashboard](https://music.ai/), create an application (API key) and a
   stem-separation workflow (e.g. outputs `vocals`, `drums`, `bass`, `guitars`, `keys`, `other`).
   Put the key and the workflow slug in `server/.env` (`MUSIC_AI_API_KEY`, `MUSIC_AI_WORKFLOW`).
2. Drop audio files into `server/songs_input/` named `Artist - Title.mp3`, or import a whole music
   folder as 15 s clips (titles cleaned from tags/file names, listed in `songs_input/_library.csv`
   with doubtful ones marked `check`):
   `.\.venv\Scripts\python -m scripts.import_library "D:/music"` (add `--dry-run` to only list them).
3. Run `.\.venv\Scripts\python -m scripts.process_songs` from `server/`. Already processed files are skipped.
   Add `--cc` for Creative Commons tracks so they land in the lobby's Creative Commons library
   (only use `--cc` for songs whose licence allows it, and fill in the artist for the credit).

To fill the Creative Commons library without Music.ai or any account, run
`.\.venv\Scripts\python -m scripts.import_cc` (add `--per-genre N`, default 2). It picks CC BY tracks
across genres from Incompetech (Kevin MacLeod) and ccMixter, stores each as one 15 s "mix" clip, and
keeps the attribution (title, author, source link, licence) that the game shows after each round.
After testing them locally (with a SQLite `DATABASE_URL`), put exactly those songs live with
`.\.venv\Scripts\python -m scripts.publish_cc sqlite:///C:/path/to/stemguess.db`: it copies only the
`cc:` songs into the database from `server/.env` and uploads only their clips to R2.

The "Preview of hits" library comes from `scripts/hits.csv` (title, artist, genre, language, YouTube link, local file), a table you can edit in Cursor or a spreadsheet app.
`.\.venv\Scripts\python -m scripts.import_hits` cuts each song's loudest 15 s and splits it with
[Demucs](https://github.com/facebookresearch/demucs) (free, runs locally) into drums, bass and other,
dropping the vocals; each song is credited with its YouTube link (the `youtube` column can also hold
another official link, e.g. Apple Music, when no YouTube upload plays). Demucs needs PyTorch, so it runs in
its own environment (`DEMUCS_PYTHON`, default `~/stem-sep/Scripts/python`; install with
`pip install torch demucs soundfile`). Clips are separated 50 at a time with the model loaded once
(on the GPU when there is one); on a laptop CPU it takes about 16-20 s per song. Songs without a file are
listed as pending. `python -m scripts.add_folder_hits "D:/music"` adds every new song in a folder to
`hits.csv` (names from tags or file names, without a YouTube link; `--dry-run` lists them first, and
`--tidy` fills in artists that are part of a title). Songs are matched by YouTube link, or by file name
when they have none, so titles can be shortened in `hits.csv`: run
`import_hits` again locally and `import_hits --sync-only` against the live database to rename them
without re-importing. Publish with `publish_cc ... --prefix hits:`. `python -m scripts.backup_hits [folder]`
copies every hits song's stems and a `songs.json` index to a backup folder (default `D:/projects/stem-guess/env/StemGuess backup/hits`).
`python -m scripts.remove_hits <YouTube id or hits:file:... source> ...` deletes songs (e.g. ones where vocals leak through)
with their stem files, and moves their rows to `hits_rejected.csv`; run it locally and against live.

## Song libraries

The host picks the song source in the lobby:

| Option | Where the audio comes from |
| --- | --- |
| StemGuess originals | Demo songs on the server (`seed_demo`) |
| Creative Commons | Server songs from `import_cc` or processed with `--cc`, credited after each round; "Coming soon" until there are enough |
| Preview of hits | Vocal-free stems of popular songs from `import_hits`, linked to their YouTube video (or Apple Music) |
| My own music | Audio files picked on the host's device |

With **My own music**, the host's browser cuts a 15 s clip from each picked file and removes the
vocals by centre-channel cancellation (left minus right, with the mix below 150 Hz added back for
bass and kick). Vocals panned off-centre or with stereo reverb partly remain, and mono files are left
as they are. The server only
receives the titles. Clips go from the host to each player over a direct WebRTC connection, or
through the server (forwarded, never stored) when a direct connection can't be made within 7 s.
The wrong options come from the same library (the host's other titles in this mode).
Songs on the server outside the demo (`demo:`), Creative Commons (`cc:`) and hits (`hits:`) libraries are never used in games.

**Song Library** (home and lobby) lists every song in any of the four sources with a player (play/pause,
5 s back/forward, previous/next, seekable progress bar, autoplay of the next song). **Practice** (its own button, or a tab
in the Song Library) plays random songs to guess solo, with a progress bar. No room needed.

**Filters**: in the lobby (host), Song Library and Practice, Filters narrow the songs by genre, language
and artist, like a shop's search filters: ticks in one list widen the pick (Pop or Dance), ticks in
different lists narrow it (Pop or Dance, and Hindi), and each option shows how many songs it would match.
A song counts for every artist it credits ("Dr. Dre ft. Eminem" is both), split the same way on the
server (`app/artists.py`, `app/filters.py`) and client (`src/artists.ts`, `src/filters.ts`). In games,
the wrong options come from the songs matching the filters when they have at least four titles.
Genres and languages come from the `genre` and `language` columns of `hits.csv`:
`python -m scripts.hits_genres` fills empty genres from Apple's iTunes Search API (song metadata only),
grouped into broad genres; languages are set by hand, comma-separated when a song has several
("English, Hindi" counts under both). Publish edits with `import_hits --sync-only`.

Joining a game that has already started offers **Spectate**: spectators see and hear every round
without answering and become players when the game ends. Players and spectators together are capped at 10. With My own music, each player's browser
keeps the game's clips in IndexedDB, so a reload mid-game doesn't need them sent again.

Cost is about $0.07 per minute of audio for standard stems (see [pricing](https://music.ai/pricing/)).

## Menu music

`client/public/audio/bg-loop.wav` plays on the home and lobby screens (with a Music on/off toggle).
Regenerate it with `.\.venv\Scripts\python -m scripts.make_bg_audio` from `server/`.

## Deploy (Render)

Create a Blueprint from `render.yaml` (Render dashboard > New > Blueprint > pick this repo): one free
web service that builds the client and runs the server. It asks for `DATABASE_URL`: paste a Postgres
connection string, e.g. from a free [Neon](https://neon.tech) project (doesn't expire) or an existing
Render Postgres (Render allows one free database per workspace). The 25 demo songs are generated
during the build, so a fresh deploy is playable right away.

Render's filesystem is ephemeral, so real song stems go to Cloudflare R2 (below).

## Host stems on Cloudflare R2

1. In the Cloudflare dashboard: R2 > Create bucket (e.g. `stem-guess`). In the bucket's Settings,
   enable the public **r2.dev** URL (or connect a custom domain) and add this CORS policy so
   browsers can load the audio:
   `[{"AllowedOrigins": ["*"], "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["*"]}]`
2. R2 > Manage API tokens > Create token with **Object Read & Write** on that bucket. Put the
   values in `server/.env`: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
   `R2_BUCKET`, `R2_PUBLIC_URL` (e.g. `https://pub-xxxx.r2.dev`).
3. Point `DATABASE_URL` in `server/.env` at the live database (the same connection string the
   Render service uses), then from `server/`:
   ```powershell
   .\.venv\Scripts\python -m scripts.process_songs   # Music.ai -> 15 s stems in server/media
   .\.venv\Scripts\python -m scripts.upload_r2       # upload them, store their public URLs
   ```
   The live server picks the new songs up immediately (no redeploy).

## Native apps (Capacitor pipeline)

Native builds load the UI from inside the app and connect to the deployed server set in
`client/.env.android` (`VITE_SERVER_URL`). Then:

```powershell
cd client
npm install @capacitor/android
npx cap add android
npm run cap:sync            # builds with .env.android and copies it into the Android project
npx cap open android        # build/run in Android Studio
```

Desktop: `npm install @capacitor-community/electron`, then `npx cap add @capacitor-community/electron`
and `npx cap open @capacitor-community/electron`.

The server must be **https** for native builds; plain-http LAN servers get blocked as mixed content.

## Music rights

Music.ai's terms make you responsible for having the rights to every track you upload and to how
you use the output. Removing vocals does not change that. Commercial songs are fine for a private
game with friends. A public release needs licensed or royalty-free music.

With "My own music", the host chooses what plays from their own files and must confirm they are
responsible for it. StemGuess doesn't store or distribute those clips.
