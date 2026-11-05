import { useEffect, useRef, useState } from 'react';
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

/**
 * The player's song tile: cover, name, artist and credit link. When the song changes, the old tile scrolls
 * out and the new one scrolls in, onward for the next song (direction 1) and back for the previous one (-1).
 * The blurred cover behind them stays still, and fades to the new song once the tile has arrived.
 */
function PlayerTile({ item, direction }: { item: Item; direction: number }) {
  const [shown, setShown] = useState(item);
  const [leaving, setLeaving] = useState<Item | null>(null);
  const [backdrop, setBackdrop] = useState(item);
  // The last backdrop stays underneath while the new one fades in over it.
  const [underBackdrop, setUnderBackdrop] = useState<Item | null>(null);

  function settle() {
    setLeaving(null);
    if (item.key === backdrop.key) return;
    setUnderBackdrop(backdrop);
    setBackdrop(item);
  }

  if (item.key !== shown.key) {
    setShown(item);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) settle();
    else setLeaving(shown);
  }

  return (
    <div className={direction < 0 ? 'player-tiles back has-backdrop' : 'player-tiles has-backdrop'}>
      {(underBackdrop && underBackdrop.key !== backdrop.key ? [underBackdrop, backdrop] : [backdrop]).map((song) => (
        <CoverBackdrop key={song.key} credit={song.credit} />
      ))}
      {/* Keyed in one list, so a tile keeps its loaded cover when it goes from entering to leaving. */}
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
            <Cover credit={song.credit} />
            <div className="player-tile-text">
              <b className="song-card-title">{song.title}</b>
              <span className="song-card-artist">{song.artist}</span>
            </div>
            <div className="player-tile-credit">{song.credit && <CreditLine credit={song.credit} />}</div>
          </div>
        );
      })}
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
  const [listOpen, setListOpen] = useState(true);
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
    const list = shown.length ? shown : listed;
    if (!list.length) return;
    const at = list.findIndex((s) => s.key === current?.key);
    void play(list[(at + by + list.length) % list.length], by);
  }

  // No scrollbar: grey lines (with arrows) above or below the list show there's more to scroll to.
  const scroll = useScrollHints<HTMLUListElement>('x');
  // Previous / next bring the playing song's card into view in the row.
  useEffect(() => {
    const card = scroll.ref.current?.querySelector<HTMLElement>('.song-card.playing');
    const row = scroll.ref.current;
    if (card && row)
      row.scrollTo({ left: card.offsetLeft - (row.clientWidth - card.offsetWidth) / 2, behavior: 'smooth' });
  }, [current?.key, listOpen, scroll.ref]);

  if (!songs) return <p className="muted small">Loading songs…</p>;
  if (!songs.length) return <p className="muted small">No songs yet.</p>;

  const isCurrent = (s: Item) => current?.key === s.key;

  return (
    <div className="song-list">
      {current && (
        <div className="player" aria-label="Player">
          {/* Next / previous only change this tile: it keeps its size, and the controls under it stay put. */}
          <PlayerTile item={current} direction={direction} />
          <div className="player-buttons">
            <button className="player-step" aria-label="Previous song" onClick={() => step(-1)}>
              ⏮
            </button>
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
            <button className="player-step" aria-label="Next song" onClick={() => step(1)}>
              ⏭
            </button>
            <button
              className="player-step list-toggle"
              aria-expanded={listOpen}
              aria-label={listOpen ? 'Hide song list' : 'Show song list'}
              title={listOpen ? 'Hide song list' : 'Show song list'}
              onClick={() => setListOpen((open) => !open)}
            >
              <svg viewBox="0 0 18 18" width="14" height="14" fill="currentColor" aria-hidden>
                <rect x="2" y="2" width="2.5" height="14" rx="1.25" />
                <rect x="7.75" y="2" width="2.5" height="14" rx="1.25" />
                <rect x="13.5" y="2" width="2.5" height="14" rx="1.25" />
              </svg>
            </button>
          </div>
          <ProgressBar seekable />
        </div>
      )}
      {/* The songs as a sideways row of cover cards. Hidden rather than removed, so it keeps its scroll place. */}
      <div className={`${scroll.wrapClassName} quiet`} hidden={!listOpen}>
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
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
