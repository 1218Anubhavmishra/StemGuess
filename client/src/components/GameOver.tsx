import { useEffect, useState } from 'react';
import { stemPlayer } from '../audio';
import { request, serverUrl } from '../socket';
import type { GameSong, Player, RoomState } from '../types';
import Brand from './Brand';
import Cover from './Cover';
import CreditLine from './CreditLine';
import DisconnectedIcon from './DisconnectedIcon';
import { ScrollArrows, WindowBody, useScrollHints } from './ScrollHints';

type Props = { room: RoomState; ranking: Player[]; songs: GameSong[]; isHost: boolean; onLeave: () => void };

export default function GameOver({ room, ranking, songs, isHost, onLeave }: Props) {
  const [error, setError] = useState('');
  // The game's songs, as a sideways row of cover cards.
  const scroll = useScrollHints<HTMLOListElement>('x');
  // Song being replayed, and whether its clip is still loading.
  const [replaying, setReplaying] = useState<{ index: number; loading: boolean } | null>(null);
  const top = ranking[0]?.score ?? 0;

  // Not stopped on unmount: the next game may already have prepared its first clip, and every way out of
  // this screen (next round, leaving, losing the room) stops the player anyway.
  useEffect(() => {
    stemPlayer.onEnded = () => setReplaying(null);
    return () => {
      stemPlayer.onEnded = undefined;
    };
  }, []);

  async function playAgain() {
    setError('');
    const ack = await request('start_game');
    if (!ack.ok) setError(ack.error ?? 'Could not start');
  }

  async function replay(index: number) {
    if (replaying?.index === index) {
      stemPlayer.stop();
      setReplaying(null);
      return;
    }
    const song = songs[index];
    stemPlayer.prepare(song.urls.map(serverUrl));
    setReplaying({ index, loading: true });
    await stemPlayer.start({ loop: false });
    setReplaying((r) => (r?.index === index && stemPlayer.isPlaying() ? { index, loading: false } : r));
  }

  return (
    <div className="overlay final-page" role="dialog" aria-modal="true" aria-label="Final scores">
      <div className="home-stack">
        <Brand />
        <div className="card narrow">
          <WindowBody>
            <h1>Final scores</h1>
            <ol className="ranking">
              {ranking.map((p, i) => (
                <li
                  key={p.id}
                  className={[p.score === top && top > 0 && 'winner', !p.connected && 'gone'].filter(Boolean).join(' ')}
                >
                  <span className="place">{i + 1}</span>
                  <span className="name">
                    {p.name}
                    {!p.connected && <DisconnectedIcon />}
                  </span>
                  <span className="score">
                    {p.score} {p.score === 1 ? 'pt' : 'pts'}
                  </span>
                </li>
              ))}
            </ol>
            {songs.length > 0 && (
              <>
                <h3 className="answers-head">The songs were</h3>
                <div className={`${scroll.wrapClassName} quiet`}>
                  <ol ref={scroll.ref} className={`song-cards answer-cards ${scroll.className}`} onScroll={scroll.onScroll}>
                    {songs.map((song, i) => {
                      const current = replaying?.index === i;
                      return (
                        <li key={i} className={current ? 'song-card playing' : 'song-card'}>
                          {/* The card replays the song, or stops the one replaying. */}
                          <button
                            className="song-card-play"
                            aria-label={current ? `Stop ${song.title}` : `Replay ${song.title}`}
                            onClick={() => void replay(i)}
                          >
                            <span className="song-card-cover">
                              <Cover credit={song.credit} />
                              <span className="song-card-place">{i + 1}</span>
                              <span className="song-card-state" aria-hidden>
                                {current ? (replaying.loading ? '…' : '■') : '▶'}
                              </span>
                            </span>
                            <b className="song-card-title">{song.title}</b>
                            {song.artist && <span className="song-card-artist muted">{song.artist}</span>}
                          </button>
                          {song.credit && <CreditLine credit={song.credit} />}
                        </li>
                      );
                    })}
                  </ol>
                  <ScrollArrows more={scroll.more} scrollBy={scroll.scrollBy} axis="x" />
                </div>
              </>
            )}
            {isHost ? (
              <button className="primary" onClick={() => void playAgain()}>
                Play again
              </button>
            ) : (
              <p className="muted">Waiting for the host…</p>
            )}
            {error && <p className="error">{error}</p>}
            <button className="ghost leave-room" onClick={onLeave}>
              Leave room
            </button>
          </WindowBody>
        </div>
      </div>
    </div>
  );
}
