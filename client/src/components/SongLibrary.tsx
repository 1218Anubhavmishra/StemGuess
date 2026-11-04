import { useState } from 'react';
import { NO_FILTERS, type SongFilters } from '../filters';
import type { Library } from '../types';
import Brand from './Brand';
import Filters, { useLibraryFacets } from './Filters';
import Practice from './Practice';
import SongList from './SongList';
import SectionNav, { type Section } from './SectionNav';

export type LibraryMode = 'songs' | 'practice';

/** Play Library (browse and play a library's songs) or Practice (guess them on your own). No room needed. */
export default function SongLibrary({
  connected,
  mode,
  onNavigate,
}: {
  connected: boolean;
  mode: LibraryMode;
  onNavigate: (section: Section) => void;
}) {
  const library: Library = 'hits';
  const [filters, setFilters] = useState<SongFilters>(NO_FILTERS);
  const [query, setQuery] = useState('');
  // Practice hides the titles, so it has no search.
  const searchable = mode === 'songs';
  const facets = useLibraryFacets(library, connected, searchable ? query : '');

  return (
    <main className="screen center">
      <div className="home-stack practice">
        <Brand music={false} />
        <div className="card narrow">
          <header className="about-head">
            <h2 className="practice-head">{mode === 'songs' ? 'Play Library' : 'Practice'}</h2>
          </header>
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
