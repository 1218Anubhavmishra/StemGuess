# Stem Guess

Multiplayer "name that song" game: each round plays a song's instrument stems one at a time
(drums, then bass, then other instruments, with vocals last). Players race to type the title,
and every correct guess earns 1 point.

| Part | Tech | Deploy |
| --- | --- | --- |
| `client/` | Vite + React + TypeScript, Socket.IO client, Web Audio | Vercel (web), Capacitor (Android / desktop) |
| `server/` | Python, FastAPI + python-socketio, SQLAlchemy | Render |
| Database | PostgreSQL (SQLite fallback for local dev) | Render Postgres |
| Stems | Music.ai API, run offline by `server/scripts/process_songs.py` | cached in `server/media/` |

The Music.ai API key stays on the server. Songs are separated **once** and the stems are cached,
so a game never triggers a paid API call.

## Local setup

Prerequisites: Node 20+, Python 3.11+, optionally [ffmpeg](https://ffmpeg.org/) on PATH
(clips stems to 45 s MP3s and drops silent stems) and Docker (for local Postgres).

### 1. Server

```powershell
cd server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env      # then fill in MUSIC_AI_API_KEY and MUSIC_AI_WORKFLOW
uvicorn app.main:app --reload --port 8000
```

Without `DATABASE_URL` the server uses `server/stemguess.db` (SQLite). For Postgres:
`docker compose up -d` in the repo root and set
`DATABASE_URL=postgresql://stemguess:stemguess@localhost:5432/stemguess`.

### 2. Add songs (Music.ai)

1. In the [Music.ai dashboard](https://music.ai/), create an application (API key) and a
   stem-separation workflow (e.g. outputs `vocals`, `drums`, `bass`, `guitars`, `keys`, `other`).
   Put its slug in `MUSIC_AI_WORKFLOW`.
2. Drop audio files into `server/songs_input/` named `Artist - Title.mp3`.
   Optional `Artist - Title.json` with `{"aliases": ["Alt title"]}` for extra accepted answers.
3. Run `python -m scripts.process_songs` from `server/`. Already processed files are skipped.

Cost is about $0.07 per minute of audio for standard stems (see [pricing](https://music.ai/pricing/)).

### 3. Client

```powershell
cd client
npm install
copy .env.example .env
npm run dev
```

Open http://localhost:5173 in two browser windows to play against yourself.

## Deploy

- **Server to Render:** create a Blueprint from `render.yaml`. Set `PUBLIC_BASE_URL` to the Render URL and
  `CORS_ORIGINS` to your Vercel URL plus `https://localhost,capacitor-electron://-` for the native apps.
  Render's filesystem is ephemeral, so for production either attach a Render Disk and set `MEDIA_DIR`
  to it, or move stems to object storage (S3 / Cloudflare R2) and point stem URLs there.
- **Client to Vercel:** import the repo, set the root directory to `client`, and set
  `VITE_SERVER_URL` to the Render URL.

## Native apps (Capacitor pipeline)

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

Native builds load the app from `https://localhost`, so `VITE_SERVER_URL` must point at an **https**
server (your Render URL). Plain-http LAN servers get blocked as mixed content.

## Music rights

Music.ai's terms make you responsible for having the rights to every track you upload and to how
you use the output. Commercial songs are fine for a private game with friends. A public release
needs licensed or royalty-free music.
