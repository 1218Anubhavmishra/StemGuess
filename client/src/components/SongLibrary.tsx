import { useEffect, useState } from 'react';
import { NO_FILTERS, type SongFilters } from '../filters';
import type { Library } from '../types';
import { BrandIcon } from './Brand';
import Filters, { useLibraryFacets } from './Filters';
import { WindowBody } from './ScrollHints';
import SongList from './SongList';
import SectionNav, { type Section } from './SectionNav';

/** Library: browse and play a library's songs. No room needed. */
export default function SongLibrary({
  connected,
  onNavigate,
  onSongSelected,
}: {
  connected: boolean;
  onNavigate: (section: Section) => void;
  onSongSelected: (selected: boolean) => void;
}) {
  const library: Library = 'hits';
  const [filters, setFilters] = useState<SongFilters>(NO_FILTERS);
  const [query, setQuery] = useState('');
  const facets = useLibraryFacets(library, connected, query);
  const [selectedSong, setSelectedSong] = useState<string | null>(null);

  const songSelected = selectedSong !== null;
  useEffect(() => {
    onSongSelected(songSelected);
    return () => onSongSelected(false);
  }, [songSelected, onSongSelected]);

  return (
    <main className="screen center">
      <header className="topbar">
        <BrandIcon />
      </header>
      <div className="home-stack library">
        <div className="card narrow">
          <WindowBody>
            <Filters
              facets={facets}
              value={filters}
              onChange={setFilters}
              search={{ value: query, onChange: setQuery }}
              collapseOn={selectedSong}
            />
            <SongList
              key={library}
              library={library}
              connected={connected}
              filters={filters}
              query={query}
              onSelectionChange={setSelectedSong}
            />
          </WindowBody>
        </div>
        <SectionNav current="songs" onGo={onNavigate} />
      </div>
    </main>
  );
}
