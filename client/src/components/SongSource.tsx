import { useEffect, useRef, useState } from 'react';
import { getTracks, makeTrack, setTracks, subscribe, type LocalTrack } from '../localLibrary';
import { request } from '../socket';
import { LOCAL_POOL_FACTOR, type Library, type RoomState } from '../types';

const CONSENT_KEY = 'stemguess:localMusicConsent';
// Bigger folders are sampled down to this many songs (titles only go to the server).
const MAX_TRACKS = 1000;
const AUDIO_EXTENSIONS = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|webm|wma|aiff?)$/i;

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

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function LocalSongs({ rounds }: { rounds: number }) {
  const tracks = useLocalTracks();
  const [consent, setConsent] = useState(() => sessionStorage.getItem(CONSENT_KEY) === '1');
  const [source, setSource] = useState('');
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const needed = rounds * LOCAL_POOL_FACTOR;

  useEffect(() => {
    // Not in React's input typings. Browsers without folder picking (iOS) fall back to a file picker.
    folderInput.current?.setAttribute('webkitdirectory', '');
  }, []);

  // Titles only (never audio) go to the server, which shows them as answer options.
  useEffect(() => {
    const id = setTimeout(() => {
      void request('set_local_tracks', { tracks: tracks.map(({ title, artist }) => ({ title, artist })) });
    }, 300);
    return () => clearTimeout(id);
  }, [tracks]);

  /** The whole selection becomes the pool; the game draws from it, so the host never picks songs. */
  function takePool(input: HTMLInputElement | null) {
    const files = [...(input?.files ?? [])].filter((f) => f.type.startsWith('audio/') || AUDIO_EXTENSIONS.test(f.name));
    if (input) input.value = '';
    if (!files.length) return;
    const folder = files[0].webkitRelativePath.split('/')[0];
    setSource(folder ? `"${folder}"` : 'your selection');
    setTracks(shuffled(files).slice(0, MAX_TRACKS).map(makeTrack));
  }

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

      <input ref={folderInput} type="file" hidden onChange={(e) => takePool(e.target)} />
      <input ref={fileInput} type="file" accept="audio/*" multiple hidden onChange={(e) => takePool(e.target)} />
      <div className="row local-pick">
        <button className="ghost" disabled={!consent} onClick={() => folderInput.current?.click()}>
          {tracks.length ? 'Choose a different music folder' : 'Choose your music folder'}
        </button>
        <button className="link small" disabled={!consent} onClick={() => fileInput.current?.click()}>
          or select all your songs
        </button>
      </div>
      <p className="muted small" role="status">
        {!tracks.length
          ? 'The game picks songs from it at random, so even you won\'t know what comes up.'
          : tracks.length < needed
            ? `Found ${tracks.length} songs in ${source || 'your music'}. A ${rounds}-song game needs at least ${needed}.`
            : `Found ${tracks.length} songs in ${source || 'your music'}. The game will pick ${rounds} at random.`}{' '}
        Only the loudest 15 seconds of a picked song are played.
      </p>
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
