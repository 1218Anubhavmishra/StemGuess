import { useEffect, useRef, useState } from 'react';
import { stemPlayer, unlockAudio } from '../audio';
import { matchesSearch, songFilter, type SongFilters } from '../filters';
import { clipOf } from '../localLibrary';
import { request, serverUrl } from '../socket';
import type { Credit, Library } from '../types';
import { sourceName } from './CreditLine';
import { ProgressBar, usePlayback } from './Playback';
import { useLocalTracks } from './SongSource';

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
  const tracks = useLocalTracks();
  const local = library === 'local';

  useEffect(
    () => () => {
      stemPlayer.onEnded = undefined;
      stemPlayer.stop();
    },
    [],
  );

  useEffect(() => {
    if (local) {
      setSongs(
        tracks.map((t) => ({
          key: `local:${t.id}`,
          title: t.title,
          artist: t.artist,
          load: async () => {
            stemPlayer.prepareClip(clipOf(t));
            return true;
          },
        })),
      );
      return;
    }
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
  }, [library, local, connected, tracks]);

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
    const target = stemPlayer.position() + seconds;
    // Skipping past the end moves on, like the song finishing.
    if (target >= stemPlayer.duration()) return step(1);
    stemPlayer.seek(target);
  }

  function step(by: number) {
    const list = shown.length ? shown : listed;
    if (!list.length) return;
    const at = list.findIndex((s) => s.key === current?.key);
    void play(list[(at + by + list.length) % list.length]);
  }

  // Each song plays once, then the next one in the list starts.
  const advance = useRef(() => {});
  advance.current = () => step(1);
  useEffect(() => {
    stemPlayer.onEnded = () => advance.current();
  }, []);

  if (!songs) return <p className="muted small">{local ? '' : 'Loading songs…'}</p>;
  if (!songs.length) return <p className="muted small">{local ? 'Pick your songs above to see them here.' : 'No songs yet.'}</p>;

  const isCurrent = (s: Item) => current?.key === s.key;

  return (
    <div className="song-list">
      {current && (
        <div className="player" aria-label="Player">
          <div className="player-head">
            <span className="song-name">
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
          </div>
          <ProgressBar seekable />
        </div>
      )}
      <ul>
        {shown.map((s) => (
          <li key={s.key} className={isCurrent(s) ? 'playing' : ''}>
            <button
              className="play-song"
              aria-label={isCurrent(s) && playing ? `Pause ${s.title}` : `Play ${s.title}`}
              disabled={loading}
              onClick={() => toggle(s)}
            >
              {isCurrent(s) && loading ? '…' : isCurrent(s) && playing ? '❚❚' : '▶'}
            </button>
            <span className="song-name">
              <b>{s.title}</b>
              {s.artist && <span className="muted"> {s.artist}</span>}
            </span>
            {s.credit?.url && (
              <a className="song-source-link small" href={s.credit.url} target="_blank" rel="noreferrer">
                {sourceName(s.credit.url)}
              </a>
            )}
          </li>
        ))}
        {!shown.length && <li className="muted small">No songs match{query.trim() && ` "${query.trim()}"`}.</li>}
      </ul>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
