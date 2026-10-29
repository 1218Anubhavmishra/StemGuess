import { useEffect, useState } from 'react';
import { stemPlayer } from '../audio';
import { request } from '../socket';
import { SONG_LIMITS, type Library, type ServerLibrary } from '../types';
import { NO_FILTERS, type SongFilters } from '../filters';
import { getFolders } from '../localLibrary';
import Brand from './Brand';
import Filters, { useLibraryFacets } from './Filters';
import Practice from './Practice';
import SongList from './SongList';
import { LibraryTabs, LocalPicker, ModeDetails, OPTIONS } from './SongSource';

export type LibraryMode = 'songs' | 'practice';

/** Browse and play any library's songs, or practise guessing them. No room needed. */
export default function SongLibrary({
  connected,
  initialMode,
  onBack,
}: {
  connected: boolean;
  initialMode: LibraryMode;
  onBack: () => void;
}) {
  const [library, setLibrary] = useState<Library>('hits');
  const [mode, setMode] = useState<LibraryMode>(initialMode);
  const [libraries, setLibraries] = useState<Record<ServerLibrary, number> | null>(null);
  const [filters, setFilters] = useState<SongFilters>(NO_FILTERS);
  const [query, setQuery] = useState('');
  // Practice hides the titles, and songs picked one by one are already known, so neither needs a search.
  const searchable = mode === 'songs' && (library !== 'local' || getFolders().length > 0);
  const facets = useLibraryFacets(library, connected, searchable ? query : '');

  useEffect(() => {
    if (!connected) return;
    void request('library').then((ack) => {
      if (!ack.ok || !ack.libraries) return;
      setLibraries(ack.libraries);
      // Servers with too few hits for a game start on the demos, as rooms do.
      if (ack.libraries.hits < SONG_LIMITS.min) setLibrary((current) => (current === 'hits' ? 'demo' : current));
    });
  }, [connected]);

  function choose(next: Library) {
    stemPlayer.stop();
    setLibrary(next);
    setFilters(NO_FILTERS);
    setQuery('');
  }

  const selected = OPTIONS.find((o) => o.id === library) ?? OPTIONS[0];

  return (
    <main className="screen center">
      <div className="home-stack practice">
        <Brand music={false} />
        <div className="card narrow">
          <header className="about-head">
            <h2 className="practice-head">Song Library</h2>
            <button className="back-button" aria-label="Back" title="Back" onClick={onBack}>
              &lt;
            </button>
          </header>
          <LibraryTabs value={library} libraries={libraries} minSongs={SONG_LIMITS.min} onChange={choose} />
          <ModeDetails key={`details-${library}`}>
            <p>{selected.notice}</p>
          </ModeDetails>
          {library === 'local' && <LocalPicker />}
          <Filters
            facets={facets}
            value={filters}
            onChange={setFilters}
            search={searchable ? { value: query, onChange: setQuery } : undefined}
          />

          <div className="segmented two" role="radiogroup" aria-label="Mode">
            {(
              [
                ['songs', 'Play'],
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
            <SongList
              key={library}
              library={library}
              connected={connected}
              filters={filters}
              query={searchable ? query : ''}
            />
          ) : (
            <Practice key={`${library}|${JSON.stringify(filters)}`} library={library} connected={connected} filters={filters} />
          )}
        </div>
      </div>
    </main>
  );
}
