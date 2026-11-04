import { useEffect, useState } from 'react';
import { stemPlayer, unlockAudio } from '../audio';
import { matchesSearch, songFilter, type SongFilters } from '../filters';
import { request, serverUrl } from '../socket';
import type { Credit, Library } from '../types';
import Cover, { coverUrl } from './Cover';
import { sourceName } from './CreditLine';
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
  load: () => Promise<boolean>;
};

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
  const { playing } = usePlayback();

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
          load: async () => {
            const clip = await request('song_clip', { id: s.id });
            if (!clip.ok || !clip.urls) return false;
            stemPlayer.prepare(clip.urls.map(serverUrl));
            return true;
          },
        })),
      );
    });
  }, [library, connected]);

  const listed = (songs ?? []).filter(songFilter(filters));
  const shown = listed.filter((s) => matchesSearch(query, s.title, s.artist, s.genre, s.language));

  async function play(item: Item) {
    unlockAudio();
    stemPlayer.stop();
    setError('');
    setCurrent(item);
    setLoading(true);
    const ok = await item.load();
    setLoading(false);
    if (!ok) {
      setError(`Could not load "${item.title}"`);
      return;
    }
    void stemPlayer.start({ loop: false });
  }

  function toggle(item: Item) {
    if (current?.key !== item.key) return void play(item);
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
    void play(list[(at + by + list.length) % list.length]);
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
      {current && (
        <div className="player" aria-label="Player">
          {/* The cover, blurred, fills the player behind everything. */}
          {coverUrl(current.credit) && (
            <div
              className="player-backdrop"
              aria-hidden
              style={{ backgroundImage: `url(${coverUrl(current.credit)})` }}
            />
          )}
          <Cover credit={current.credit} />
          <span className="song-name player-name">
            <b>{current.title}</b>
            {current.artist && <span className="muted"> {current.artist}</span>}
          </span>
          <div className="player-buttons">
            <button className="player-step" aria-label="Previous song" disabled={loading} onClick={() => step(-1)}>
              ⏮
            </button>
            <button
              className="player-step player-skip"
              aria-label={`Back ${SKIP_SECONDS} seconds`}
              disabled={loading}
              onClick={() => skip(-SKIP_SECONDS)}
            >
              -{SKIP_SECONDS}
            </button>
            <button
              className="play-song"
              aria-label={playing ? 'Pause' : 'Play'}
              disabled={loading}
              onClick={() => toggle(current)}
            >
              {loading ? '…' : playing ? '❚❚' : '▶'}
            </button>
            <button
              className="player-step player-skip"
              aria-label={`Forward ${SKIP_SECONDS} seconds`}
              disabled={loading}
              onClick={() => skip(SKIP_SECONDS)}
            >
              +{SKIP_SECONDS}
            </button>
            <button className="player-step" aria-label="Next song" disabled={loading} onClick={() => step(1)}>
              ⏭
            </button>
          </div>
          <ProgressBar seekable />
        </div>
      )}
      {/* The songs as a sideways row of cover cards. */}
      <div className={scroll.wrapClassName}>
        <ul ref={scroll.ref} className={`song-cards ${scroll.className}`} onScroll={scroll.onScroll}>
          {shown.map((s) => (
            <li key={s.key} className={isCurrent(s) ? 'song-card playing' : 'song-card'}>
              {/* The card plays the song (or pauses / resumes the one playing). */}
              <button
                className="song-card-play"
                aria-label={isCurrent(s) && playing ? `Pause ${s.title}` : `Play ${s.title}`}
                aria-current={isCurrent(s) || undefined}
                disabled={loading}
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
