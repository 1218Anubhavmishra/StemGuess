/**
 * Artists of a song, for choosing which artists' songs to play. Mirrors server/app/artists.py:
 * "Dr. Dre ft. Eminem" credits both Dr. Dre and Eminem.
 */
const SEPARATORS = /\s*(?:,|&|;|\/|\+|\bx\b|\bvs\.?(?=\s)|\bft\b\.?|\bfeat\b\.?|\bfeaturing\b)\s*/i;
/** One act whose name contains a separator. */
const WHOLE_ACTS = /(?<!\w)(AC\/DC|HUNTR\/X|Bob Marley & The Wailers)(?!\w)/i;
const NOT_ARTISTS = new Set(['friends', 'others', 'various', 'various artists', 'unknown', 'unknown artist']);

export const artistKey = (name: string) => name.split(/\s+/).filter(Boolean).join(' ').toLowerCase();

export function splitArtists(text: string): string[] {
  // split with a group puts the whole acts at the odd positions.
  return (text || '')
    .split(WHOLE_ACTS)
    .flatMap((piece, i) => (i % 2 ? [piece] : piece.split(SEPARATORS)))
    .map((part) => part.split(/\s+/).filter(Boolean).join(' '))
    .filter((name) => name && !NOT_ARTISTS.has(name.toLowerCase()));
}
