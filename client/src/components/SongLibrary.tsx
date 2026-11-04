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
import SectionNav, { type Section } from './SectionNav';
import { LibraryTabs, LocalPicker, ModeDetails, OPTIONS } from './SongSource';

export type LibraryMode = 'songs' | 'practice';

/** Play Library (browse and play a library's songs) or Practice (guess them on your own). No room needed. */
export default function SongLibrary({
  connected,
  mode,
  onBack,
  onNavigate,
}: {
  connected: boolean;
  mode: LibraryMode;
  onBack: () => void;
  onNavigate: (section: Section) => void;
}) {
  const [library, setLibrary] = useState<Library>('hits');
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
            <h2 className="practice-head">{mode === 'songs' ? 'Play Library' : 'Practice'}</h2>
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

          {mode === 'songs' ? (
            <SongList
              key={library}
              library={library}
              connected={connected}
              filters={filters}
              query={searchable ? query : ''}
            />
          ) : (
            <Practice
              key={`${library}|${JSON.stringify(filters)}`}
              library={library}
              connected={connected}
              filters={filters}
            />
          )}
        </div>
        <SectionNav current={mode} onGo={onNavigate} />
      </div>
    </main>
  );
}
