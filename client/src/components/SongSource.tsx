import { useEffect, useRef, useState } from 'react';
import { getFolder, getTracks, makeTrack, setTracks, subscribe, type LocalTrack } from '../localLibrary';
import { request } from '../socket';
import { LOCAL_POOL_FACTOR, type Library, type RoomState } from '../types';

const CONSENT_KEY = 'stemguess:localMusicConsent';
// Bigger folders are sampled down to this many songs (titles only go to the server).
const MAX_TRACKS = 1000;
const AUDIO_EXTENSIONS = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|webm|wma|aiff?)$/i;

const OPTIONS: { id: Library; label: string; notice: string; howItWorks?: string }[] = [
  {
    id: 'demo',
    label: 'StemGuess demos',
    notice: 'Original & free to play demo tracks by StemGuess.',
    howItWorks:
      'In this mode, the game will randomly pick the chosen number of songs from the StemGuess demo tracks. ' +
      'So no player (even us) will ever know the songs that will be picked for the game.',
  },
  {
    id: 'cc',
    label: 'Creative Commons',
    notice: 'Songs their artists share under Creative Commons licences, credited after each round.',
    howItWorks:
      'In this mode, the game will randomly pick the chosen number of songs from the Creative Commons library. ' +
      'So no player (even us) will ever know the songs that will be picked for the game.',
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
  const [empty, setEmpty] = useState('');
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
    const all = [...(input?.files ?? [])];
    if (input) input.value = '';
    if (!all.length) return;
    // Browsers only reveal the chosen folder's name, never its full path on the device.
    const folder = all[0].webkitRelativePath.split('/')[0];
    const files = all.filter((f) => f.type.startsWith('audio/') || AUDIO_EXTENSIONS.test(f.name));
    if (!files.length) {
      setEmpty(folder ? `No songs found in "${folder}". Choose a folder with audio files.` : 'None of those files are songs.');
      return;
    }
    setEmpty('');
    setTracks(shuffled(files).slice(0, MAX_TRACKS).map(makeTrack), folder);
  }

  const folder = getFolder();

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
        I understand
      </label>

      <input ref={folderInput} type="file" hidden onChange={(e) => takePool(e.target)} />
      <input ref={fileInput} type="file" accept="audio/*" multiple hidden onChange={(e) => takePool(e.target)} />
      <div className="row local-pick">
        <button className="ghost" disabled={!consent} onClick={() => folderInput.current?.click()}>
          {tracks.length ? 'Choose a different folder' : 'Choose a folder with songs'}
        </button>
        <button className="link small" disabled={!consent} onClick={() => fileInput.current?.click()}>
          or select song files
        </button>
      </div>
      {tracks.length > 0 && (
        <p className="chosen-folder" title={folder || undefined}>
          📁 {folder || 'Selected files'}
        </p>
      )}
      <p className="muted small">
        In this mode, the game will randomly pick the chosen number of songs from that folder. So no player (even us)
        will ever know the songs that will be picked for the game.
      </p>
      {empty && <p className="error small">{empty}</p>}
      {tracks.length > 0 && (
        <p className="muted small" role="status">
          {tracks.length < needed
            ? `Found ${tracks.length} songs. A ${rounds}-song game needs at least ${needed}.`
            : `Found ${tracks.length} songs. The game will pick ${rounds} at random.`}
        </p>
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
      <div className="notice small">
        <p>{selected.notice}</p>
        {selected.howItWorks && <p>{selected.howItWorks}</p>}
      </div>
      {room.library === 'local' ? (
        <LocalSongs rounds={rounds} />
      ) : (
        libraries && (
          <p className="muted small" role="status">
            Found {libraries[room.library]} songs. The game will pick {rounds} at random.
          </p>
        )
      )}
    </fieldset>
  );
}
