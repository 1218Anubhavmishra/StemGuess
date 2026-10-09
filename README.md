# Stem Guess

Multiplayer "name that song" game: each round plays a song's instrument stems one at a time
(drums, then bass, then other instruments, with vocals last). Players race to type the title,
and a correct guess earns more points the fewer stems were needed. The host picks how many songs a game has (3-10) and the
room's max player count (2-10).

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

For quick testing without Music.ai, add ten synthetic demo songs (from `server/`):
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
2. Drop audio files into `server/songs_input/` named `Artist - Title.mp3`.
   Optional `Artist - Title.json` with `{"aliases": ["Alt title"]}` for extra accepted answers.
3. Run `.\.venv\Scripts\python -m scripts.process_songs` from `server/`. Already processed files are skipped.

Cost is about $0.07 per minute of audio for standard stems (see [pricing](https://music.ai/pricing/)).

## Menu music

`client/public/audio/bg-loop.wav` plays on the home and lobby screens (with a Music on/off toggle).
Regenerate it with `.\.venv\Scripts\python -m scripts.make_bg_audio` from `server/`.

## Deploy (Render)

Create a Blueprint from `render.yaml` (Render dashboard > New > Blueprint > pick this repo): one free
web service (builds the client, runs the server) plus a free Postgres database. The ten demo songs
are generated during the build, so a fresh deploy is playable right away.

Render's filesystem is ephemeral, so real song stems go to Cloudflare R2 (below).

## Host stems on Cloudflare R2

1. In the Cloudflare dashboard: R2 > Create bucket (e.g. `stem-guess`). In the bucket's Settings,
   enable the public **r2.dev** URL (or connect a custom domain) and add this CORS policy so
   browsers can load the audio:
   `[{"AllowedOrigins": ["*"], "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["*"]}]`
2. R2 > Manage API tokens > Create token with **Object Read & Write** on that bucket. Put the
   values in `server/.env`: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
   `R2_BUCKET`, `R2_PUBLIC_URL` (e.g. `https://pub-xxxx.r2.dev`).
3. Point `DATABASE_URL` in `server/.env` at the live database (Render Postgres > Connect >
   External URL), then from `server/`:
   ```powershell
   .\.venv\Scripts\python -m scripts.process_songs   # Music.ai -> 15 s stems in server/media
   .\.venv\Scripts\python -m scripts.upload_r2       # upload them, store their public URLs
   ```
   The live server picks the new songs up immediately (no redeploy).

## Native apps (Capacitor pipeline)

Native builds load the UI from inside the app, so point them at your deployed server first:
set `VITE_SERVER_URL=https://<your-render-url>` in `client/.env`, then:

```powershell
cd client
npm run build
npm install @capacitor/android
npx cap add android
npx cap sync
npx cap open android        # build/run in Android Studio
```

Desktop: `npm install @capacitor-community/electron`, then `npx cap add @capacitor-community/electron`
and `npx cap open @capacitor-community/electron`.

The server must be **https** for native builds; plain-http LAN servers get blocked as mixed content.

## Music rights

Music.ai's terms make you responsible for having the rights to every track you upload and to how
you use the output. Removing vocals does not change that. Commercial songs are fine for a private
game with friends. A public release needs licensed or royalty-free music.
