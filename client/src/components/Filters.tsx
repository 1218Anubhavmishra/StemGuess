import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { artistKey } from '../artists';
import {
  FILTER_KINDS,
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
   * The song search, sharing a box with the filters' dropdown arrow. The facets must already be of the songs
   * matching it, so it narrows the songs and finds the genres, languages and artists to choose from.
   */
  search: { value: string; onChange: (query: string) => void };
  /** The dropdown closes whenever this changes to a new non-null value. */
  collapseOn?: string | null;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (collapseOn != null) setOpen(false);
  }, [collapseOn]);
  const [openKind, setOpenKind] = useState<FilterKind | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [filterCaret, setFilterCaret] = useState<number | null>(null);
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
  const chosen = FILTER_KINDS.flatMap((kind) => value[kind].map((name) => ({ kind, name })));
  // The cursor among the filters: before the filter at this index. Null when it's in the search text.
  const caret = filterCaret !== null && filterCaret < chosen.length ? filterCaret : null;
  const searched = search.value.trim();
  const matching = (facets ?? []).filter(songFilter(value)).reduce((n, row) => n + row.songs, 0);
  const count = `${matching} song${matching === 1 ? '' : 's'}`;

  function toggle(kind: FilterKind, name: string) {
    const key = artistKey(name);
    const on = value[kind].some((v) => artistKey(v) === key);
    onChange({ ...value, [kind]: on ? value[kind].filter((v) => artistKey(v) !== key) : [...value[kind], name] });
  }

  /**
   * The search box's keys reach past the text into the filters. The arrow keys, Home and End move a cursor between
   * them: Backspace removes the filter before it and Delete the one after it. With the cursor in the text,
   * Backspace at its start and Delete in an empty box remove the last filter. Holding a key down never removes
   * filters, so clearing the text doesn't also wipe them.
   */
  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    const { selectionStart, selectionEnd, value: text } = e.currentTarget;
    const count = chosen.length;
    const remove = (index: number) => {
      if (!e.repeat) toggle(chosen[index].kind, chosen[index].name);
    };

    if (caret === null) {
      if (!count) return;
      const atStart = selectionStart === 0 && selectionEnd === 0;
      if (e.key === 'Delete' && !text) {
        e.preventDefault();
        remove(count - 1);
      } else if (atStart && e.key === 'Backspace') {
        e.preventDefault();
        remove(count - 1);
      } else if (atStart && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'Home')) {
        e.preventDefault();
        setFilterCaret(e.key === 'Home' ? 0 : count - 1);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        setFilterCaret(Math.max(0, caret - 1));
        break;
      case 'ArrowRight':
        e.preventDefault();
        setFilterCaret(caret + 1 < count ? caret + 1 : null);
        break;
      case 'Home':
        e.preventDefault();
        setFilterCaret(0);
        break;
      case 'End':
        setFilterCaret(null);
        break;
      case 'Backspace':
        e.preventDefault();
        if (caret > 0 && !e.repeat) {
          remove(caret - 1);
          setFilterCaret(caret - 1);
        }
        break;
      case 'Delete':
        e.preventDefault();
        if (!e.repeat) {
          remove(caret);
          setFilterCaret(caret + 1 < count ? caret : null);
        }
        break;
    }
  }

  return (
    <div className="artist-picker">
      {/* One box: the chosen filters, then the search, then the arrow that opens the filters on its right edge. */}
      <div className="search-box">
        <div className="search-field">
          {chosen.map(({ kind, name }, index) => (
            <Fragment key={`${kind}:${name}`}>
              {caret === index && <span className="filter-caret" aria-hidden />}
              <button
                className="chip"
                aria-label={`Remove ${name}`}
                onClick={() => toggle(kind, name)}
                onKeyDown={(e) => {
                  if (e.key !== 'Backspace' && e.key !== 'Delete') return;
                  e.preventDefault();
                  toggle(kind, name);
                  searchInput.current?.focus();
                }}
              >
                {name}
                <span aria-hidden> ×</span>
              </button>
            </Fragment>
          ))}
          <input
            ref={searchInput}
            type="search"
            className={caret === null ? 'song-search' : 'song-search caret-away'}
            placeholder={chosen.length ? undefined : 'Search or filter songs'}
            aria-label="Search songs, artists, genres or languages"
            value={search.value}
            onChange={(e) => {
              setFilterCaret(null);
              search.onChange(e.target.value);
              if (e.target.value.trim()) setOpen(true);
            }}
            onKeyDown={onSearchKey}
            onMouseDown={() => setFilterCaret(null)}
            onBlur={() => setFilterCaret(null)}
          />
        </div>
        {facets && kinds.length > 0 && (
          <button
            className="search-toggle"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} filters, ${count}`}
            title="Filters"
            onClick={() => setOpen((o) => !o)}
          >
            <b>{count}</b>
            <span className="artist-caret" aria-hidden>
              {open ? '▴' : '▾'}
            </span>
          </button>
        )}
      </div>
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
                    <ScrollRow className="filter-tiles" label={LABELS[kind]}>
                      {available.map((o) => {
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
                      {!available.length && <li className="muted small">No artists match.</li>}
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
