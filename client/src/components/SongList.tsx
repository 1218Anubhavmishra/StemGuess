import { useEffect, useState } from 'react';
import { stemPlayer, unlockAudio } from '../audio';
import { clipOf } from '../localLibrary';
import { request, serverUrl } from '../socket';
import type { Credit, Library } from '../types';
import { useLocalTracks } from './SongSource';

type Item = { key: string; title: string; artist: string; credit?: Credit | null; play: () => Promise<boolean> };

/** Every song in a library; pick one to hear its clip. Remount per library. */
export default function SongList({ library, connected }: { library: Library; connected: boolean }) {
  const [songs, setSongs] = useState<Item[] | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const tracks = useLocalTracks();
  const local = library === 'local';

  useEffect(() => () => stemPlayer.stop(), []);

  useEffect(() => {
    if (local) {
      setSongs(
        tracks.map((t) => ({
          key: `local:${t.id}`,
          title: t.title,
          artist: t.artist,
          play: async () => {
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
          credit: s.credit,
          play: async () => {
            const clip = await request('song_clip', { id: s.id });
            if (!clip.ok || !clip.urls) return false;
            stemPlayer.prepare(clip.urls.map(serverUrl));
            return true;
          },
        })),
      );
    });
  }, [library, local, connected, tracks]);

  async function toggle(item: Item) {
    unlockAudio();
    stemPlayer.stop();
    if (playing === item.key) {
      setPlaying(null);
      return;
    }
    setError('');
    setLoadingKey(item.key);
    const ok = await item.play();
    setLoadingKey(null);
    if (!ok) {
      setPlaying(null);
      setError(`Could not load "${item.title}"`);
      return;
    }
    setPlaying(item.key);
    void stemPlayer.start();
  }

  const needle = query.trim().toLowerCase();
  const shown = (songs ?? []).filter((s) => !needle || `${s.title} ${s.artist}`.toLowerCase().includes(needle));

  if (!songs) return <p className="muted small">{local ? '' : 'Loading songs…'}</p>;
  if (!songs.length) return <p className="muted small">{local ? 'Pick your songs above to see them here.' : 'No songs yet.'}</p>;

  return (
    <div className="song-list">
      <input
        className="song-search"
        type="search"
        placeholder={`Search ${songs.length} songs`}
        aria-label="Search songs"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul>
        {shown.map((s) => (
          <li key={s.key} className={playing === s.key ? 'playing' : ''}>
            <button
              className="play-song"
              aria-label={playing === s.key ? `Stop ${s.title}` : `Play ${s.title}`}
              disabled={loadingKey !== null}
              onClick={() => void toggle(s)}
            >
              {loadingKey === s.key ? '…' : playing === s.key ? '■' : '▶'}
            </button>
            <span className="song-name">
              <b>{s.title}</b>
              {s.artist && <span className="muted"> {s.artist}</span>}
            </span>
            {s.credit?.url && (
              <a className="song-source-link small" href={s.credit.url} target="_blank" rel="noreferrer">
                {s.credit.url.includes('youtube.com') ? 'YouTube' : 'Source'}
              </a>
            )}
          </li>
        ))}
        {!shown.length && <li className="muted small">No songs match "{query}".</li>}
      </ul>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
