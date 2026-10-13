import { useEffect, useState } from 'react';
import { stemPlayer } from '../audio';
import { request } from '../socket';
import { SONG_LIMITS, type Library, type ServerLibrary } from '../types';
import Brand from './Brand';
import Practice from './Practice';
import SongList from './SongList';
import { LibraryTabs, LocalPicker, OPTIONS } from './SongSource';

type Mode = 'songs' | 'practice';

/** Browse and play any library's songs, or practise guessing them. No room needed. */
export default function PlayLibrary({ connected, onBack }: { connected: boolean; onBack: () => void }) {
  const [library, setLibrary] = useState<Library>('demo');
  const [mode, setMode] = useState<Mode>('songs');
  const [libraries, setLibraries] = useState<Record<ServerLibrary, number> | null>(null);

  useEffect(() => {
    if (connected) void request('library').then((ack) => ack.ok && setLibraries(ack.libraries ?? null));
  }, [connected]);

  function choose(next: Library) {
    stemPlayer.stop();
    setLibrary(next);
  }

  const selected = OPTIONS.find((o) => o.id === library) ?? OPTIONS[0];

  return (
    <main className="screen center">
      <div className="home-stack practice">
        <Brand music={false} />
        <div className="card narrow">
          <h2 className="practice-head">Play Library</h2>
          <LibraryTabs value={library} libraries={libraries} minSongs={SONG_LIMITS.min} onChange={choose} />
          <p className="notice small">{selected.notice}</p>
          {library === 'local' && <LocalPicker />}

          <div className="segmented two" role="radiogroup" aria-label="Mode">
            {(
              [
                ['songs', 'All songs'],
                ['practice', 'Practice'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="radio"
                aria-checked={mode === id}
                className={mode === id ? 'on' : ''}
                onClick={() => {
                  stemPlayer.stop();
                  setMode(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'songs' ? (
            <SongList key={library} library={library} connected={connected} />
          ) : (
            <Practice key={library} library={library} connected={connected} />
          )}

          <button className="ghost leave-room back" onClick={onBack}>
            <span className="arrow" aria-hidden>
              ←
            </span>
            Back
          </button>
        </div>
      </div>
    </main>
  );
}
