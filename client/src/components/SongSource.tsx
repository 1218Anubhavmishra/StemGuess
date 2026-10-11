import { useEffect, useRef, useState } from 'react';
import { getTracks, makeTrack, setTracks, subscribe, type LocalTrack } from '../localLibrary';
import { request } from '../socket';
import { LOCAL_POOL_FACTOR, type Library, type RoomState } from '../types';

const CONSENT_KEY = 'stemguess:localMusicConsent';
const MAX_TRACKS = 200;

const OPTIONS: { id: Library; label: string; notice: string }[] = [
  {
    id: 'demo',
    label: 'StemGuess demos',
    notice: 'Original & free to play demo tracks by StemGuess.',
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
  demo: 'Original & free to play demo tracks by StemGuess.',
  cc: 'Songs shared by their artists under Creative Commons licences.',
  local: "Songs come from the host's device and are shared only with this room. StemGuess doesn't store them.",
};

function useLocalTracks(): LocalTrack[] {
  const [tracks, set] = useState(getTracks);
  useEffect(() => subscribe(() => set(getTracks())), []);
  return tracks;
}

function LocalSongs({ rounds }: { rounds: number }) {
  const tracks = useLocalTracks();
  const [consent, setConsent] = useState(() => sessionStorage.getItem(CONSENT_KEY) === '1');
  const fileInput = useRef<HTMLInputElement>(null);
  const needed = rounds * LOCAL_POOL_FACTOR;

  // Titles only (never audio) go to the server, which shows them as answer options.
  useEffect(() => {
    const id = setTimeout(() => {
      void request('set_local_tracks', { tracks: tracks.map(({ title, artist }) => ({ title, artist })) });
    }, 300);
    return () => clearTimeout(id);
  }, [tracks]);

  function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setTracks([...getTracks(), ...[...files].map(makeTrack)].slice(0, MAX_TRACKS));
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
      <button className="ghost" disabled={!consent || tracks.length >= MAX_TRACKS} onClick={() => fileInput.current?.click()}>
        + Add songs from this device
      </button>
      <p className="muted small">
        {tracks.length < needed
          ? `Add at least ${needed} songs for a ${rounds}-song game (${tracks.length} so far). `
          : `The game will pick ${rounds} of your ${tracks.length} songs at random. `}
        Only the loudest 15 seconds of a picked song are played.
      </p>

      {tracks.length > 0 && (
        <details className="local-titles">
          <summary>Review titles ({tracks.length})</summary>
          <p className="muted small">Titles are shown as answer options, so fix any that look wrong.</p>
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
        </details>
      )}
    </div>
  );
}

export default function SongSource({
  room,
  libraries,
  minSongs,
  rounds,
  onChange,
}: {
  room: RoomState;
  libraries: Record<'demo' | 'cc', number> | null;
  minSongs: number;
  rounds: number;
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
      {room.library === 'local' && <LocalSongs rounds={rounds} />}
    </fieldset>
  );
}
