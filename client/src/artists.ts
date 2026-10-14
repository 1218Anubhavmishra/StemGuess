/**
 * Artists of a song, for choosing which artists' songs to play. Mirrors server/app/artists.py:
 * "Dr. Dre ft. Eminem" credits both Dr. Dre and Eminem.
 */
export type ArtistCount = { name: string; songs: number };

const SEPARATORS = /\s*(?:,|&|;|\/|\+|\bx\b|\bvs\.?(?=\s)|\bft\b\.?|\bfeat\b\.?|\bfeaturing\b)\s*/i;
const NOT_ARTISTS = new Set(['friends', 'others', 'various', 'various artists', 'unknown', 'unknown artist']);

export const artistKey = (name: string) => name.split(/\s+/).filter(Boolean).join(' ').toLowerCase();

export function splitArtists(text: string): string[] {
  return (text || '')
    .split(SEPARATORS)
    .map((part) => part.split(/\s+/).filter(Boolean).join(' '))
    .filter((name) => name && !NOT_ARTISTS.has(name.toLowerCase()));
}

/** True when no artists are chosen, or the song credits one of them. */
export function byArtists(chosen: string[]) {
  const keys = new Set(chosen.map(artistKey));
  return (artist: string) => !keys.size || splitArtists(artist).some((name) => keys.has(artistKey(name)));
}

/** Every artist with their song count, most songs first. */
export function countArtists(artists: string[]): ArtistCount[] {
  const counts = new Map<string, { names: Map<string, number>; songs: number }>();
  for (const text of artists) {
    const names = new Map(splitArtists(text).map((n) => [artistKey(n), n]));
    for (const [key, name] of names) {
      const entry = counts.get(key) ?? { names: new Map(), songs: 0 };
      entry.songs += 1;
      entry.names.set(name, (entry.names.get(name) ?? 0) + 1);
      counts.set(key, entry);
    }
  }
  return [...counts.values()]
    .map(({ names, songs }) => ({ name: [...names].sort((a, b) => b[1] - a[1])[0][0], songs }))
    .sort((a, b) => b.songs - a.songs || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
