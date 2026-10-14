import { useEffect, useMemo, useState } from 'react';
import { artistKey, countArtists, type ArtistCount } from '../artists';
import { request } from '../socket';
import type { Library } from '../types';
import { useLocalTracks } from './SongSource';

/** The artists in a library with their song counts (null while loading). */
export function useLibraryArtists(library: Library, connected: boolean): ArtistCount[] | null {
  const tracks = useLocalTracks();
  const [server, setServer] = useState<{ library: Library; artists: ArtistCount[] } | null>(null);
  const local = useMemo(() => countArtists(tracks.map((t) => t.artist)), [tracks]);

  useEffect(() => {
    if (library === 'local' || !connected) return;
    let live = true;
    void request('library_artists', { library }).then((ack) => {
      if (live && ack.ok) setServer({ library, artists: ack.artists ?? [] });
    });
    return () => {
      live = false;
    };
  }, [library, connected]);

  if (library === 'local') return local;
  return server?.library === library ? server.artists : null;
}

export function artistSummary(chosen: string[]) {
  if (!chosen.length) return 'All artists';
  if (chosen.length <= 2) return chosen.join(', ');
  return `${chosen.slice(0, 2).join(', ')} +${chosen.length - 2}`;
}

/** Choose which artists' songs play; none chosen means every song. */
export default function ArtistPicker({
  artists,
  chosen,
  onChange,
  matching,
}: {
  artists: ArtistCount[] | null;
  chosen: string[];
  onChange: (next: string[]) => void;
  /** Songs by the chosen artists, shown next to the summary. */
  matching?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const chosenKeys = new Set(chosen.map(artistKey));
  const needle = query.trim().toLowerCase();
  const shown = (artists ?? []).filter((a) => !needle || a.name.toLowerCase().includes(needle));

  function toggle(name: string) {
    const key = artistKey(name);
    onChange(chosenKeys.has(key) ? chosen.filter((c) => artistKey(c) !== key) : [...chosen, name]);
  }

  // Hidden while loading, and when there are too few artists to choose between.
  if ((!artists || artists.length < 2) && !chosen.length) return null;

  return (
    <div className="artist-picker">
      <button className="artist-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="muted">Artists:</span> <b>{artistSummary(chosen)}</b>
        {chosen.length > 0 && matching != null && (
          <span className="muted small">
            {' '}
            ({matching} song{matching === 1 ? '' : 's'})
          </span>
        )}
        <span className="artist-caret" aria-hidden>
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="artist-panel">
          {!artists ? (
            <p className="muted small">Loading artists…</p>
          ) : (
            <>
              <div className="artist-tools">
                <input
                  type="search"
                  className="song-search"
                  placeholder={`Search ${artists.length} artists`}
                  aria-label="Search artists"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button className="ghost small" disabled={!chosen.length} onClick={() => onChange([])}>
                  All artists
                </button>
              </div>
              <ul className="artist-list" aria-label="Artists">
                {shown.map((a) => (
                  <li key={a.name}>
                    <label>
                      <input type="checkbox" checked={chosenKeys.has(artistKey(a.name))} onChange={() => toggle(a.name)} />
                      <span className="artist-name">{a.name}</span>
                      <span className="muted small">{a.songs}</span>
                    </label>
                  </li>
                ))}
                {!shown.length && <li className="muted small">No artists match "{query}".</li>}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
