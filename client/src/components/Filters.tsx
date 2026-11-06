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
import Cover from './Cover';
import { ScrollRow } from './ScrollHints';

const LABELS: Record<FilterKind, string> = { genres: 'Genre', languages: 'Language', artists: 'Artist' };

/** How long typing pauses before a search is sent to the server. */
export const SEARCH_DELAY_MS = 300;

/** Song counts per artist, genre and language in a library, of the songs matching a search (null while loading). */
export function useLibraryFacets(library: Library, connected: boolean, search = ''): FacetRow[] | null {
  const [server, setServer] = useState<{ library: Library; facets: FacetRow[] } | null>(null);

  useEffect(() => {
    if (!connected) return;
    let live = true;
    // The last counts stay up while typing; they're replaced once the typing pauses.
    const timer = setTimeout(
      () =>
        void request('library_facets', { library, search }).then((ack) => {
          if (live && ack.ok) setServer({ library, facets: ack.facets ?? [] });
        }),
      search ? SEARCH_DELAY_MS : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [library, connected, search]);

  return server?.library === library ? server.facets : null;
}

type Option = { name: string; songs: number; url?: string };

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

/** Gives each option the link of one of its songs for a cover, a different song from the options before it if it can. */
function assignCovers(options: Option[], rows: FacetRow[], kind: FilterKind) {
  const links = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.url) continue;
    for (const value of valuesOf(row, kind)) {
      const key = artistKey(value);
      links.set(key, [...(links.get(key) ?? []), row.url]);
    }
  }
  const used = new Set<string>();
  for (const option of options) {
    const own = links.get(artistKey(option.name)) ?? [];
    option.url = own.find((link) => !used.has(link)) ?? own[0];
    if (option.url) used.add(option.url);
  }
}

/** Kinds worth a list: two or more values to choose between, or something already chosen. */
function filterKinds(facets: FacetRow[], value: SongFilters) {
  return FILTER_KINDS.filter((kind) => countValues(facets, kind).size >= 2 || value[kind].length > 0);
}

/** Whether <Filters> shows its song count; null while loading. */
export function showsFilters(facets: FacetRow[] | null, value: SongFilters, search = ''): boolean | null {
  return facets ? filterKinds(facets, value).length > 0 || search.trim() !== '' : null;
}

/**
 * Choose songs by genre, language and artist, like a shop's search filters: options picked in one list
 * widen the pick, options in different lists narrow it. Each option shows how many songs it would add.
 * The lists fold under their category's button, one open at a time; each button shows how many options it holds.
 */
export default function Filters({
  facets,
  value,
  onChange,
  search,
  collapseOn,
}: {
  facets: FacetRow[] | null;
  value: SongFilters;
  onChange: (next: SongFilters) => void;
  /**
   * A song search shown above the filters. The facets must already be of the songs matching it, so it
   * narrows the songs and finds the genres, languages and artists to choose from.
   */
  search?: { value: string; onChange: (query: string) => void };
  /** The dropdown closes whenever this changes to a new non-null value. */
  collapseOn?: string | null;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (collapseOn != null) setOpen(false);
  }, [collapseOn]);
  const [openKind, setOpenKind] = useState<FilterKind | null>(null);
  const [artistQuery, setArtistQuery] = useState('');
  // Every value of each kind in a fixed order (most songs in the whole library first), so lists don't jump.
  const all = useMemo(() => {
    const out = {} as Record<FilterKind, Option[]>;
    for (const kind of FILTER_KINDS) {
      out[kind] = [...countValues(facets ?? [], kind).values()].sort(
        (a, b) => b.songs - a.songs || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      );
      assignCovers(out[kind], facets ?? [], kind);
    }
    return out;
  }, [facets]);

  const kinds = filterKinds(facets ?? [], value);
  // Without a search, hidden while loading and when there's nothing to choose between.
  if (!search && (!facets?.length || !kinds.length)) return null;

  const chosen = FILTER_KINDS.flatMap((kind) => value[kind].map((name) => ({ kind, name })));
  const searched = search?.value.trim() ?? '';
  const needle = artistQuery.trim().toLowerCase();
  const matching = (facets ?? []).filter(songFilter(value)).reduce((n, row) => n + row.songs, 0);
  const count = `${matching} song${matching === 1 ? '' : 's'}`;

  function toggle(kind: FilterKind, name: string) {
    const key = artistKey(name);
    const on = value[kind].some((v) => artistKey(v) === key);
    onChange({ ...value, [kind]: on ? value[kind].filter((v) => artistKey(v) !== key) : [...value[kind], name] });
  }

  return (
    <div className="artist-picker">
      {search && (
        <input
          type="search"
          className="song-search"
          placeholder="Search songs, artists, genres or languages"
          aria-label="Search songs, artists, genres or languages"
          value={search.value}
          onChange={(e) => {
            search.onChange(e.target.value);
            if (e.target.value.trim()) setOpen(true);
          }}
        />
      )}
      {chosen.length > 0 && (
        <div className="filter-chips" aria-label="Chosen filters">
          {chosen.map(({ kind, name }) => (
            <button
              key={`${kind}:${name}`}
              className="chip"
              aria-label={`Remove ${name}`}
              onClick={() => toggle(kind, name)}
            >
              {name}
              <span aria-hidden> ×</span>
            </button>
          ))}
          <button className="link small" onClick={() => onChange(NO_FILTERS)}>
            Clear all
          </button>
        </div>
      )}
      {facets && kinds.length > 0 && (
        <button className="artist-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="muted">Filters</span>
          <b>({count})</b>
          <span className="artist-caret" aria-hidden>
            {open ? '▴' : '▾'}
          </span>
        </button>
      )}
      {facets && !kinds.length && searched && (
        <p className="muted small">
          {count} match "{searched}".
        </p>
      )}
      {open && facets && kinds.length > 0 && (
        <div className="artist-panel">
          {kinds.map((kind) => {
            // Counts follow the other lists' ticks, as in a shop's filters; options with no songs are hidden.
            const counts = countValues((facets ?? []).filter(songFilter(value, kind)), kind);
            const ticked = new Set(value[kind].map(artistKey));
            const available = all[kind].filter(
              (o) => ticked.has(artistKey(o.name)) || (counts.get(artistKey(o.name))?.songs ?? 0) > 0,
            );
            if (!available.length && kind !== 'artists') return null;
            const expanded = openKind === kind;
            const options = available.filter(
              (o) =>
                ticked.has(artistKey(o.name)) ||
                kind !== 'artists' ||
                !needle ||
                o.name.toLowerCase().includes(needle),
            );
            return (
              <section key={kind} className="facet">
                <button
                  className="facet-toggle"
                  aria-expanded={expanded}
                  onClick={() => setOpenKind(expanded ? null : kind)}
                >
                  <span>{LABELS[kind]}</span>
                  <b>({available.length})</b>
                  <span className="artist-caret" aria-hidden>
                    {expanded ? '▴' : '▾'}
                  </span>
                </button>
                {expanded && (
                  <div className="facet-body">
                    {kind === 'artists' && !search && (
                      <input
                        type="search"
                        className="song-search"
                        placeholder={`Search ${all.artists.length} artists`}
                        aria-label="Search artists"
                        value={artistQuery}
                        onChange={(e) => setArtistQuery(e.target.value)}
                      />
                    )}
                    <ScrollRow className="filter-tiles" label={LABELS[kind]}>
                      {options.map((o) => {
                        const songs = counts.get(artistKey(o.name))?.songs ?? 0;
                        const on = ticked.has(artistKey(o.name));
                        return (
                          <li key={o.name}>
                            <button
                              className={on ? 'filter-tile on' : 'filter-tile'}
                              aria-pressed={on}
                              onClick={() => toggle(kind, o.name)}
                            >
                              <Cover credit={o.url ? { text: '', url: o.url } : null} lazy />
                              <span className="filter-tile-name">{o.name}</span>
                              <span className="filter-tile-count">
                                {songs} song{songs === 1 ? '' : 's'}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                      {!options.length && (
                        <li className="muted small">No artists match{needle && ` "${artistQuery}"`}.</li>
                      )}
                    </ScrollRow>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
