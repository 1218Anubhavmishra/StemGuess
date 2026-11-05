import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { stemPlayer, unlockAudio } from '../audio';
import { matchesSearch, songFilter, type SongFilters } from '../filters';
import { request, serverUrl } from '../socket';
import type { Credit, Library } from '../types';
import Cover, { CoverBackdrop } from './Cover';
import CreditLine, { sourceName } from './CreditLine';
import { ProgressBar, usePlayback } from './Playback';
import { ScrollArrows, useScrollHints } from './ScrollHints';

const SKIP_SECONDS = 5;

type Item = {
  key: string;
  title: string;
  artist: string;
  genre?: string;
  language?: string;
  credit?: Credit | null;
  /** The song's audio files, or null if they can't be had. */
  urls: () => Promise<string[] | null>;
};

type Slot = { song: Item; slot: number };
const SLOT_ORDER = [0, 1, -1, 2, -2];

/**
 * The covers around the current song: slot 0 is the current one, -1 and 1 the previous and next, and -2 and 2
 * wait out of sight, so their pictures are loaded and they slide in when the song changes. A slot the list
 * can't fill without repeating a song (a very short list) is left out.
 */
function coverSlots(list: Item[], current: Item): Slot[] {
  const at = list.findIndex((s) => s.key === current.key);
  const taken = new Set<string>();
  const slots: Slot[] = [];
  for (const slot of SLOT_ORDER) {
    // A current song the filters no longer list sits just before the first song.
    const index = at >= 0 ? at + slot : slot > 0 ? slot - 1 : slot;
    const song = slot === 0 ? current : list[((index % list.length) + list.length) % list.length];
    if (!song || taken.has(song.key)) continue;
    taken.add(song.key);
    slots.push({ song, slot });
  }
  return slots;
}

/**
 * The current song's cover with the previous and next songs' covers, semi-visible, beside it: tap one to go
 * to that song. When the song changes, each cover slides to its new slot.
 */
function PlayerCovers({ slots, way, onStep }: { slots: Slot[]; way: number; onStep: (by: number) => void }) {
  const signature = slots.map(({ song, slot }) => `${song.key}:${slot}`).join();
  const [seen, setSeen] = useState({ signature, slots, gone: [] as Item[] });
  // Covers losing their slot stay a moment longer, sliding out of sight.
  if (seen.signature !== signature) {
    const kept = new Set(slots.map(({ song }) => song.key));
    setSeen({ signature, slots, gone: seen.slots.filter(({ song }) => !kept.has(song.key)).map(({ song }) => song) });
  }
  const all = [...slots, ...seen.gone.map((song) => ({ song, slot: -2 * way }))];
  return (
    <div className="player-covers">
      {/* In a fixed order: moving an element in the page would cut its slide short. */}
      {all
        .sort((a, b) => (a.song.key < b.song.key ? -1 : 1))
        .map(({ song, slot }) => {
          const place = slot === 0 ? 'current' : Math.abs(slot) === 1 ? 'side' : 'away';
          const label = `${slot < 0 ? 'Previous' : 'Next'} song: ${song.title}`;
          return (
            <button
              key={song.key}
              className={`player-cover ${place}`}
              style={{ '--slot': slot } as CSSProperties}
              disabled={place !== 'side'}
              inert={place === 'away'}
              aria-label={place === 'side' ? label : undefined}
              title={place === 'side' ? label : undefined}
              onClick={() => onStep(slot)}
            >
              <Cover credit={song.credit} />
            </button>
          );
        })}
    </div>
  );
}

/**
 * The player's box: the current song's covers, name, artist and credit link over its blurred cover, then the
 * children. When the song changes, the old name scrolls out and the new one scrolls in, onward for the next
 * song (direction 1) and back for the previous one (-1). The blurred cover stays still, and fades to the new
 * song once they have arrived. Before a song is picked the box holds just the children.
 */
function Player({
  item,
  slots,
  direction,
  onStep,
  children,
}: {
  item: Item | null;
  slots: Slot[];
  direction: number;
  onStep: (by: number) => void;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(item);
  const [leaving, setLeaving] = useState<Item | null>(null);
  const [backdrop, setBackdrop] = useState(item);
  // The last backdrop stays underneath while the new one fades in over it.
  const [underBackdrop, setUnderBackdrop] = useState<Item | null>(null);

  function settle() {
    setLeaving(null);
    if (!item || item.key === backdrop?.key) return;
    setUnderBackdrop(backdrop);
    setBackdrop(item);
  }

  if (item?.key !== shown?.key) {
    setShown(item);
    if (!shown || matchMedia('(prefers-reduced-motion: reduce)').matches) settle();
    else setLeaving(shown);
  }

  const backdrops = underBackdrop && underBackdrop.key !== backdrop?.key ? [underBackdrop, backdrop] : [backdrop];

  return (
    <div className={direction < 0 ? 'player back has-backdrop' : 'player has-backdrop'} aria-label="Player">
      {backdrops.map((song) => song && <CoverBackdrop key={song.key} credit={song.credit} />)}
      {item && (
        <>
          <PlayerCovers slots={slots} way={direction} onStep={onStep} />
          <div className="player-tiles">
            {/* Keyed in one list, so a tile stays the same element when it goes from entering to leaving. */}
            {(leaving ? [leaving, item] : [item]).map((song) => {
              const isLeaving = song === leaving;
              return (
                <div
                  key={song.key}
                  className={`player-tile${isLeaving ? ' leaving' : leaving ? ' entering' : ''}`}
                  inert={isLeaving}
                  onAnimationEnd={(e) => {
                    if (e.target === e.currentTarget && isLeaving) settle();
                  }}
                >
                  <div className="player-tile-text">
                    <b className="song-card-title">{song.title}</b>
                    <span className="song-card-artist">{song.artist}</span>
                  </div>
                  <div className="player-tile-credit">{song.credit && <CreditLine credit={song.credit} />}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {children}
    </div>
  );
}

/** Every song in a library, with a player: pick a song, pause, seek, skip. Remount per library. */
export default function SongList({
  library,
  connected,
  filters,
  query,
}: {
  library: Library;
  connected: boolean;
  /** Only songs matching these are listed. */
  filters: SongFilters;
  /** Only songs whose title, artist, genre or language contains this are listed. */
  query: string;
}) {
  const [songs, setSongs] = useState<Item[] | null>(null);
  const [current, setCurrent] = useState<Item | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Which way the player's tile scrolls to the current song: 1 onward, -1 back.
  const [direction, setDirection] = useState(1);
  // Re-renders as playback moves; asking the player itself means the buttons are never a frame behind.
  usePlayback();
  const playing = stemPlayer.isPlaying();
  // The latest song asked for. The controls stay live while it loads, so a quick next-next can overtake a load.
  const latestPlay = useRef(0);

  useEffect(
    () => () => {
      stemPlayer.onEnded = undefined;
      stemPlayer.stop();
    },
    [],
  );

  useEffect(() => {
    if (!connected) return;
    void request('library_songs', { library }).then((ack) => {
      if (!ack.ok) return setError(ack.error ?? 'Could not load the songs');
      setSongs(
        (ack.songs ?? []).map((s) => ({
          key: String(s.id),
          title: s.title,
          artist: s.artist,
          genre: s.genre,
          language: s.language,
          credit: s.credit,
          urls: async () => {
            const clip = await request('song_clip', { id: s.id });
            return clip.ok && clip.urls ? clip.urls.map(serverUrl) : null;
          },
        })),
      );
    });
  }, [library, connected]);

  const listed = (songs ?? []).filter(songFilter(filters));
  const shown = listed.filter((s) => matchesSearch(query, s.title, s.artist, s.genre, s.language));
  // The covers around the current song follow the songs on show, or all the filtered ones if the search finds none.
  const slots = current ? coverSlots(shown.length ? shown : listed, current) : [];

  async function play(item: Item, way: number) {
    unlockAudio();
    stemPlayer.stop();
    setError('');
    setDirection(way);
    setCurrent(item);
    setLoading(true);
    const thisPlay = ++latestPlay.current;
    const urls = await item.urls();
    if (thisPlay !== latestPlay.current) return;
    if (urls) {
      stemPlayer.prepare(urls);
      await stemPlayer.start({ loop: false });
      if (thisPlay !== latestPlay.current) return;
    } else {
      setError(`Could not load "${item.title}"`);
    }
    setLoading(false);
  }

  function toggle(item: Item) {
    if (current?.key !== item.key) {
      // A card earlier in the list scrolls back to it, a later one onward.
      const way = current && listed.indexOf(item) < listed.indexOf(current) ? -1 : 1;
      return void play(item, way);
    }
    // Already on its way.
    if (loading) return;
    unlockAudio();
    if (playing) stemPlayer.pause();
    else stemPlayer.resume();
  }

  function skip(seconds: number) {
    // Within the song: skipping past the end stops at the end, without moving to the next song.
    stemPlayer.seek(Math.min(stemPlayer.position() + seconds, stemPlayer.duration()));
  }

  function step(by: number) {
    const target = slots.find(({ slot }) => slot === by);
    if (target) void play(target.song, by);
  }

  // No scrollbar: grey lines (with arrows) above or below the list show there's more to scroll to.
  const scroll = useScrollHints<HTMLUListElement>('x');
  // Previous / next bring the playing song's card into view in the row.
  useEffect(() => {
    const card = scroll.ref.current?.querySelector<HTMLElement>('.song-card.playing');
    const row = scroll.ref.current;
    if (card && row)
      row.scrollTo({ left: card.offsetLeft - (row.clientWidth - card.offsetWidth) / 2, behavior: 'smooth' });
  }, [current?.key, scroll.ref]);

  if (!songs) return <p className="muted small">Loading songs…</p>;
  if (!songs.length) return <p className="muted small">No songs yet.</p>;

  const isCurrent = (s: Item) => current?.key === s.key;

  return (
    <div className="song-list">
      <Player item={current} slots={slots} direction={direction} onStep={step}>
        {current && (
          <>
            <div className="player-buttons">
              <button
                className="player-step player-skip"
                aria-label={`Back ${SKIP_SECONDS} seconds`}
                onClick={() => skip(-SKIP_SECONDS)}
              >
                -{SKIP_SECONDS}
              </button>
              <button
                className="play-song"
                aria-label={playing || loading ? 'Pause' : 'Play'}
                onClick={() => toggle(current)}
              >
                {playing || loading ? '❚❚' : '▶'}
              </button>
              <button
                className="player-step player-skip"
                aria-label={`Forward ${SKIP_SECONDS} seconds`}
                onClick={() => skip(SKIP_SECONDS)}
              >
                +{SKIP_SECONDS}
              </button>
            </div>
            <ProgressBar seekable />
          </>
        )}
        {/* The songs as a sideways row of cover cards. */}
        <div className={`${scroll.wrapClassName} quiet player-list`}>
          <ul ref={scroll.ref} className={`song-cards ${scroll.className}`} onScroll={scroll.onScroll}>
            {shown.map((s) => (
              <li key={s.key} className={isCurrent(s) ? 'song-card playing' : 'song-card'}>
                {/* The card plays the song (or pauses / resumes the one playing). */}
                <button
                  className="song-card-play"
                  aria-label={isCurrent(s) && playing ? `Pause ${s.title}` : `Play ${s.title}`}
                  aria-current={isCurrent(s) || undefined}
                  onClick={() => toggle(s)}
                >
                  <Cover credit={s.credit} lazy />
                  <b className="song-card-title">{s.title}</b>
                  {s.artist && <span className="song-card-artist muted">{s.artist}</span>}
                </button>
                {s.credit?.url && (
                  <a className="song-source-link small" href={s.credit.url} target="_blank" rel="noreferrer">
                    Listen on {sourceName(s.credit.url)}
                  </a>
                )}
              </li>
            ))}
            {!shown.length && <li className="muted small">No songs match{query.trim() && ` "${query.trim()}"`}.</li>}
          </ul>
          <ScrollArrows more={scroll.more} scrollBy={scroll.scrollBy} axis="x" />
        </div>
      </Player>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
