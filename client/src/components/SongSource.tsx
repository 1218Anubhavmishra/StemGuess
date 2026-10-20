import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getFolder, getTracks, makeTrack, setTracks, subscribe, type LocalTrack } from '../localLibrary';
import { request } from '../socket';
import { LOCAL_POOL_FACTOR, type Library, type RoomState, type ServerLibrary } from '../types';

const CONSENT_KEY = 'stemguess:localMusicConsent';
// Bigger folders are sampled down to this many songs (titles only go to the server).
const MAX_TRACKS = 1000;
const AUDIO_EXTENSIONS = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|webm|wma|aiff?)$/i;

export const OPTIONS: { id: Library; label: string; notice: string; howItWorks?: string }[] = [
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
    id: 'hits',
    label: 'Preview of hits',
    notice: 'Short previews of popular hits, with the vocals taken out. Songs link to their YouTube video (or Apple Music) after the round.',
    howItWorks:
      'In this mode, the game will randomly pick the chosen number of songs from the hits previews. ' +
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
  hits: 'Preview of hits',
  local: "🎵 Host's music",
};

// Only these libraries show their notice in the room lobby.
export const GUEST_NOTICES: Partial<Record<Library, string>> = {
  hits: 'Short previews of popular hits, with the vocals taken out.',
  local: "Songs come from the host's device and are shared only with this room. StemGuess doesn't store them.",
};

export function useLocalTracks(): LocalTrack[] {
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

/** Consent, folder / file pickers and the chosen folder's name. `hint` goes under the folder name. */
export function LocalPicker({ hint }: { hint?: ReactNode }) {
  const tracks = useLocalTracks();
  const [consent, setConsent] = useState(() => sessionStorage.getItem(CONSENT_KEY) === '1');
  const [empty, setEmpty] = useState('');
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Not in React's input typings. Browsers without folder picking (iOS) fall back to a file picker.
    folderInput.current?.setAttribute('webkitdirectory', '');
  }, []);

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
      {hint}
      {empty && <p className="error small">{empty}</p>}
    </div>
  );
}

function LocalSongs({ rounds, showCount }: { rounds: number; showCount: boolean }) {
  const tracks = useLocalTracks();
  const needed = rounds * LOCAL_POOL_FACTOR;

  // Titles only (never audio) go to the server, which shows them as answer options.
  useEffect(() => {
    const id = setTimeout(() => {
      void request('set_local_tracks', { tracks: tracks.map(({ title, artist }) => ({ title, artist })) });
    }, 300);
    return () => clearTimeout(id);
  }, [tracks]);

  return (
    <LocalPicker
      hint={
        <>
          <p className="muted small">
            In this mode, the game will randomly pick the chosen number of songs from that folder. So no player (even
            us) will ever know the songs that will be picked for the game.
          </p>
          {tracks.length > 0 && (tracks.length < needed || showCount) && (
            <p className="muted small" role="status">
              {tracks.length < needed
                ? `Found ${tracks.length} songs. A ${rounds}-song game needs at least ${needed}.`
                : `Found ${tracks.length} songs. The game will pick ${rounds} at random.`}
            </p>
          )}
        </>
      }
    />
  );
}

/** Server libraries with fewer than `minSongs` songs show "Coming soon" and can't be picked. */
export function LibraryTabs({
  value,
  libraries,
  minSongs,
  onChange,
}: {
  value: Library;
  libraries: Record<ServerLibrary, number> | null;
  minSongs: number;
  onChange: (library: Library) => void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {OPTIONS.map((o) => {
        const disabled = o.id !== 'local' && o.id !== 'demo' && (libraries?.[o.id] ?? 0) < minSongs;
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={value === o.id}
            className={value === o.id ? 'on' : ''}
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
  );
}

export default function SongSource({
  room,
  libraries,
  minSongs,
  rounds,
  showCount,
  onChange,
}: {
  room: RoomState;
  libraries: Record<ServerLibrary, number> | null;
  minSongs: number;
  rounds: number;
  /** Say how many songs were found (when no Filters button shows the count). */
  showCount: boolean;
  onChange: (library: Library) => void;
}) {
  const selected = OPTIONS.find((o) => o.id === room.library) ?? OPTIONS[0];

  return (
    <fieldset className="song-source">
      <legend>Songs from</legend>
      <LibraryTabs value={room.library} libraries={libraries} minSongs={minSongs} onChange={onChange} />
      {GUEST_NOTICES[room.library] ? (
        <div className="notice small">
          <p>{selected.notice}</p>
          {selected.howItWorks && <p>{selected.howItWorks}</p>}
        </div>
      ) : (
        selected.howItWorks && <p className="muted small">{selected.howItWorks}</p>
      )}
      {room.library === 'local' ? (
        <LocalSongs rounds={rounds} showCount={showCount} />
      ) : (
        libraries &&
        showCount && (
          <p className="muted small" role="status">
            Found {room.poolSize ?? libraries[room.library]} songs. The game will pick {rounds} at random.
          </p>
        )
      )}
    </fieldset>
  );
}
