import { useEffect, useRef, useState } from 'react';
import { getTracks, makeTrack, setTracks, subscribe, type LocalTrack } from '../localLibrary';
import { request } from '../socket';
import type { Library, RoomState } from '../types';

const CONSENT_KEY = 'stemguess:localMusicConsent';

const OPTIONS: { id: Library; label: string; notice: string }[] = [
  {
    id: 'demo',
    label: 'StemGuess demos',
    notice: 'Original tracks made for StemGuess. Free to play, no copyright concerns.',
  },
  {
    id: 'cc',
    label: 'Creative Commons',
    notice: 'Songs their artists share under Creative Commons licences, credited after each round.',
  },
  {
    id: 'local',
    label: 'My music',
    notice:
      "Songs stay on your device and are shared only with players in this room. StemGuess doesn't store them. " +
      "You're responsible for the music you share: sharing commercial songs without permission may break " +
      'copyright law where you live.',
  },
];

export const LIBRARY_LABELS: Record<Library, string> = {
  demo: 'StemGuess demos',
  cc: 'Creative Commons songs',
  local: "🎵 Host's music",
};

export const GUEST_NOTICES: Record<Library, string> = {
  demo: 'Original tracks made for StemGuess.',
  cc: 'Songs shared by their artists under Creative Commons licences.',
  local: "Songs come from the host's device and are shared only with this room. StemGuess doesn't store them.",
};

function useLocalTracks(): LocalTrack[] {
  const [tracks, set] = useState(getTracks);
  useEffect(() => subscribe(() => set(getTracks())), []);
  return tracks;
}

function LocalSongs({ minSongs }: { minSongs: number }) {
  const tracks = useLocalTracks();
  const [consent, setConsent] = useState(() => sessionStorage.getItem(CONSENT_KEY) === '1');
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  // Titles only (never audio) go to the server, which needs them to check guesses.
  useEffect(() => {
    const id = setTimeout(() => {
      void request('set_local_tracks', { tracks: tracks.map(({ title, artist }) => ({ title, artist })) });
    }, 300);
    return () => clearTimeout(id);
  }, [tracks]);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files];
    const errors: string[] = [];
    for (const [i, file] of list.entries()) {
      setBusy(`Preparing ${i + 1} of ${list.length}: ${file.name}`);
      try {
        const track = await makeTrack(file);
        setTracks([...getTracks(), track]);
      } catch {
        errors.push(file.name);
      }
    }
    setBusy(null);
    setFailed(errors);
    if (fileInput.current) fileInput.current.value = '';
  }

  const update = (id: number, patch: Partial<LocalTrack>) =>
    setTracks(getTracks().map((t) => (t.id === id ? { ...t, ...patch } : t)));

  return (
    <div className="local-songs">
      <label className="consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => {
            setConsent(e.target.checked);
            sessionStorage.setItem(CONSENT_KEY, e.target.checked ? '1' : '0');
          }}
        />
        I understand and will only use music I have the right to share.
      </label>

      <input
        ref={fileInput}
        type="file"
        accept="audio/*"
        multiple
        hidden
        onChange={(e) => void addFiles(e.target.files)}
      />
      <button className="ghost" disabled={!consent || !!busy} onClick={() => fileInput.current?.click()}>
        + Add songs from this device
      </button>
      {busy && <p className="muted small" role="status">{busy}</p>}
      {failed.length > 0 && <p className="error small">Couldn't read: {failed.join(', ')}</p>}

      {tracks.length > 0 && (
        <>
          <p className="muted small">
            Check each title: players must type it to score. Only the loudest 15 seconds of each song are used.
          </p>
          <ul className="local-list">
            {tracks.map((t) => (
              <li key={t.id}>
                <input
                  aria-label="Song title"
                  placeholder="Title"
                  value={t.title}
                  maxLength={150}
                  onChange={(e) => update(t.id, { title: e.target.value })}
                />
                <input
                  aria-label="Artist"
                  placeholder="Artist"
                  value={t.artist}
                  maxLength={150}
                  onChange={(e) => update(t.id, { artist: e.target.value })}
                />
                <button
                  className="ghost small"
                  aria-label={`Remove ${t.title}`}
                  onClick={() => setTracks(getTracks().filter((x) => x.id !== t.id))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {tracks.length < minSongs && (
        <p className="muted small">
          Add at least {minSongs} songs ({tracks.length} so far).
        </p>
      )}
    </div>
  );
}

export default function SongSource({
  room,
  libraries,
  minSongs,
  onChange,
}: {
  room: RoomState;
  libraries: Record<'demo' | 'cc', number> | null;
  minSongs: number;
  onChange: (library: Library) => void;
}) {
  const selected = OPTIONS.find((o) => o.id === room.library) ?? OPTIONS[0];
  const ccReady = (libraries?.cc ?? 0) >= minSongs;

  return (
    <fieldset className="song-source">
      <legend>Songs from</legend>
      <div className="segmented" role="radiogroup">
        {OPTIONS.map((o) => {
          const disabled = o.id === 'cc' && !ccReady;
          return (
            <button
              key={o.id}
              role="radio"
              aria-checked={room.library === o.id}
              className={room.library === o.id ? 'on' : ''}
              disabled={disabled}
              title={disabled ? 'Coming soon' : undefined}
              onClick={() => onChange(o.id)}
            >
              {o.label}
              {disabled && <small>Coming soon</small>}
            </button>
          );
        })}
      </div>
      <p className="notice small">{selected.notice}</p>
      {room.library === 'local' && <LocalSongs minSongs={minSongs} />}
    </fieldset>
  );
}
