import { useEffect, useMemo, useState } from 'react';
import { artistKey } from '../artists';
import {
  FILTER_KINDS,
  NO_FILTERS,
  songFilter,
  valuesOf,
  type FacetRow,
  type FilterKind,
  type SongFilters,
} from '../filters';
import { request } from '../socket';
import type { Library } from '../types';
import { useLocalTracks } from './SongSource';

const LABELS: Record<FilterKind, string> = { genres: 'Genre', languages: 'Language', artists: 'Artist' };

/** Song counts per artist, genre and language in a library (null while loading). */
export function useLibraryFacets(library: Library, connected: boolean): FacetRow[] | null {
  const tracks = useLocalTracks();
  const [server, setServer] = useState<{ library: Library; facets: FacetRow[] } | null>(null);
  const local = useMemo(() => tracks.map((t) => ({ artist: t.artist, genre: '', language: '', songs: 1 })), [tracks]);

  useEffect(() => {
    if (library === 'local' || !connected) return;
    let live = true;
    void request('library_facets', { library }).then((ack) => {
      if (live && ack.ok) setServer({ library, facets: ack.facets ?? [] });
    });
    return () => {
      live = false;
    };
  }, [library, connected]);

  if (library === 'local') return local;
  return server?.library === library ? server.facets : null;
}

type Option = { name: string; songs: number };

/** Songs per value of one kind, keyed by artistKey(value). */
function countValues(rows: FacetRow[], kind: FilterKind): Map<string, Option> {
  const counts = new Map<string, Option>();
  for (const row of rows) {
    for (const name of new Map(valuesOf(row, kind).map((v) => [artistKey(v), v])).values()) {
      const entry = counts.get(artistKey(name)) ?? { name, songs: 0 };
      entry.songs += row.songs;
      counts.set(artistKey(name), entry);
    }
  }
  return counts;
}

/** Kinds worth a list: two or more values to choose between, or something already chosen. */
function filterKinds(facets: FacetRow[], value: SongFilters) {
  return FILTER_KINDS.filter((kind) => countValues(facets, kind).size >= 2 || value[kind].length > 0);
}

/** Whether <Filters> (and so its song count) shows; null while loading. */
export function showsFilters(facets: FacetRow[] | null, value: SongFilters): boolean | null {
  return facets ? filterKinds(facets, value).length > 0 : null;
}

/**
 * Choose songs by genre, language and artist, like a shop's search filters: ticks in one list widen
 * the pick, ticks in different lists narrow it. Each option shows how many songs it would add.
 */
export default function Filters({
  facets,
  value,
  onChange,
}: {
  facets: FacetRow[] | null;
  value: SongFilters;
  onChange: (next: SongFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Every value of each kind in a fixed order (most songs in the whole library first), so lists don't jump.
  const all = useMemo(() => {
    const out = {} as Record<FilterKind, Option[]>;
    for (const kind of FILTER_KINDS) {
      out[kind] = [...countValues(facets ?? [], kind).values()].sort(
        (a, b) => b.songs - a.songs || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      );
    }
    return out;
  }, [facets]);

  const kinds = filterKinds(facets ?? [], value);
  // Hidden while loading, and when there's nothing to choose between.
  if (!kinds.length) return null;

  const chosen = FILTER_KINDS.flatMap((kind) => value[kind].map((name) => ({ kind, name })));
  const matching = (facets ?? []).filter(songFilter(value)).reduce((n, row) => n + row.songs, 0);
  const needle = query.trim().toLowerCase();

  function toggle(kind: FilterKind, name: string) {
    const key = artistKey(name);
    const on = value[kind].some((v) => artistKey(v) === key);
    onChange({ ...value, [kind]: on ? value[kind].filter((v) => artistKey(v) !== key) : [...value[kind], name] });
  }

  return (
    <div className="artist-picker">
      {chosen.length > 0 && (
        <div className="filter-chips" aria-label="Chosen filters">
          {chosen.map(({ kind, name }) => (
            <button key={`${kind}:${name}`} className="chip" aria-label={`Remove ${name}`} onClick={() => toggle(kind, name)}>
              {name}
              <span aria-hidden> ×</span>
            </button>
          ))}
          <button className="link small" onClick={() => onChange(NO_FILTERS)}>
            Clear all
          </button>
        </div>
      )}
      <button className="artist-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="muted">Filters</span>
        {facets && (
          <b>
            ({matching} song{matching === 1 ? '' : 's'})
          </b>
        )}
        <span className="artist-caret" aria-hidden>
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="artist-panel">
          {kinds.map((kind) => {
            // Counts follow the other lists' ticks, as in a shop's filters; options with no songs are hidden.
            const counts = countValues((facets ?? []).filter(songFilter(value, kind)), kind);
            const ticked = new Set(value[kind].map(artistKey));
            const options = all[kind].filter(
              (o) =>
                ticked.has(artistKey(o.name)) ||
                ((counts.get(artistKey(o.name))?.songs ?? 0) > 0 &&
                  (kind !== 'artists' || !needle || o.name.toLowerCase().includes(needle))),
            );
            if (!options.length && kind !== 'artists') return null;
            return (
              <fieldset key={kind} className="facet">
                <legend>{LABELS[kind]}</legend>
                {kind === 'artists' && (
                  <input
                    type="search"
                    className="song-search"
                    placeholder={`Search ${all.artists.length} artists`}
                    aria-label="Search artists"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                )}
                <ul className={kind === 'artists' ? 'artist-list' : 'artist-list facet-grid'} aria-label={LABELS[kind]}>
                  {options.map((o) => {
                    const songs = counts.get(artistKey(o.name))?.songs ?? 0;
                    const on = ticked.has(artistKey(o.name));
                    return (
                      <li key={o.name}>
                        <label>
                          <input type="checkbox" checked={on} onChange={() => toggle(kind, o.name)} />
                          <span className="artist-name">{o.name}</span>
                          <span className="muted small">{songs}</span>
                        </label>
                      </li>
                    );
                  })}
                  {!options.length && <li className="muted small">No artists match{needle && ` "${query}"`}.</li>}
                </ul>
              </fieldset>
            );
          })}
        </div>
      )}
    </div>
  );
}
