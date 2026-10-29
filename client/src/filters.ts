/**
 * Which songs a game or practice draws from. Mirrors server/app/filters.py: a song can have several
 * genres, languages and artists; choices of one kind widen the pick (Pop or Dance); kinds narrow it
 * (Pop or Dance, and in Hindi). Nothing chosen means any. A search keeps songs whose title, artist,
 * genre or language contains it.
 */
import { artistKey, splitArtists } from './artists';

export type FilterKind = 'genres' | 'languages' | 'artists';
export type SongFilters = Record<FilterKind, string[]>;
export const FILTER_KINDS: FilterKind[] = ['genres', 'languages', 'artists'];
export const NO_FILTERS: SongFilters = { genres: [], languages: [], artists: [] };
export const FILTER_LABELS: Record<FilterKind, string> = { genres: 'Genres', languages: 'Languages', artists: 'Artists' };

/** Songs sharing an artist credit, genre and language. */
export type FacetRow = { artist: string; genre: string; language: string; songs: number };
type SongFields = { artist: string; genre?: string; language?: string };

/** The values a song has for one kind: every genre ("Indian, Pop"), language ("Hindi, English") or artist it credits. */
export function valuesOf(song: SongFields, kind: FilterKind): string[] {
  if (kind === 'artists') return splitArtists(song.artist);
  return ((kind === 'languages' ? song.language : song.genre) ?? '').split(',').map((v) => v.trim()).filter(Boolean);
}

export function hasFilters(filters: SongFilters) {
  return FILTER_KINDS.some((kind) => filters[kind].length > 0);
}

/** A search as the server keeps it: single spaces, none at the ends. */
export function tidySearch(search: string) {
  return search.split(/\s+/).filter(Boolean).join(' ');
}

/** Whether a song's title, artist, genre or language contains the search (any song when it's empty). */
export function matchesSearch(search: string, ...fields: (string | undefined)[]) {
  const needle = tidySearch(search).toLowerCase();
  return !needle || fields.some((f) => (f ?? '').toLowerCase().includes(needle));
}

/** A test for songs matching every kind, optionally ignoring one kind (for that kind's counts). */
export function songFilter(filters: SongFilters, ignore?: FilterKind) {
  const keys = FILTER_KINDS.filter((kind) => kind !== ignore && filters[kind].length).map(
    (kind) => [kind, new Set(filters[kind].map(artistKey))] as const,
  );
  return (song: SongFields) =>
    keys.every(([kind, chosen]) => valuesOf(song, kind).some((value) => chosen.has(artistKey(value))));
}
