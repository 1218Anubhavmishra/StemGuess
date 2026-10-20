/**
 * Artists of a song, for choosing which artists' songs to play. Mirrors server/app/artists.py:
 * "Dr. Dre ft. Eminem" credits both Dr. Dre and Eminem.
 */
const SEPARATORS = /\s*(?:,|&|;|\/|\+|\bx\b|\bvs\.?(?=\s)|\bft\b\.?|\bfeat\b\.?|\bfeaturing\b)\s*/i;
const NOT_ARTISTS = new Set(['friends', 'others', 'various', 'various artists', 'unknown', 'unknown artist']);

export const artistKey = (name: string) => name.split(/\s+/).filter(Boolean).join(' ').toLowerCase();

export function splitArtists(text: string): string[] {
  return (text || '')
    .split(SEPARATORS)
    .map((part) => part.split(/\s+/).filter(Boolean).join(' '))
    .filter((name) => name && !NOT_ARTISTS.has(name.toLowerCase()));
}
