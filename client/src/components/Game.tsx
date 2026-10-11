import { useEffect, useRef, useState } from 'react';
import { stemPlayer } from '../audio';
import { request } from '../socket';
import type { FeedItem, Phase, RoomState, RoundAnswer } from '../types';
import Brand from './Brand';
import Scoreboard from './Scoreboard';
import SpeakerIcon from './SpeakerIcon';

type Props = {
  room: RoomState;
  meId: string;
  phase: Phase;
  options: string[];
  choice: number | null;
  onPick: (option: number) => void;
  endsAt: number | null;
  nextAt: number | null;
  answer: RoundAnswer | null;
  feed: FeedItem[];
  transfer: { ready: number; total: number } | null;
  onLeave: () => void;
};

function useCountdown(endsAt: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!endsAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [endsAt]);
  return endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : null;
}

const pointsLabel = (n: number) => `${n} point${n === 1 ? '' : 's'}`;

const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export default function Game({
  room,
  meId,
  phase,
  options,
  choice,
  onPick,
  endsAt,
  nextAt,
  answer,
  feed,
  transfer,
  onLeave,
}: Props) {
  const [hint, setHint] = useState('');
  const [volume, setVolume] = useState(stemPlayer.getVolume());
  const [muted, setMuted] = useState(stemPlayer.isMuted());
  const feedRef = useRef<HTMLUListElement>(null);
  const secondsLeft = useCountdown(endsAt);
  const nextIn = useCountdown(nextAt);
  const me = room.players.find((p) => p.id === meId);
  const roundWinners = Object.keys(answer?.points ?? {});
  const canPick = phase === 'playing' && choice === null && !me?.attempted;
  const result = phase === 'roundEnd' && answer;

  useEffect(() => setHint(''), [room.round]);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [feed]);

  async function pick(option: number) {
    if (!canPick) return;
    onPick(option);
    const ack = await request('guess', { option });
    if (ack.error) setHint(ack.error);
  }

  const optionClass = (i: number) =>
    [
      'option',
      i === choice ? 'picked' : '',
      result && i === answer.correct ? 'right' : '',
      result && i === choice && i !== answer.correct ? 'wrong' : '',
    ]
      .filter(Boolean)
      .join(' ');

  return (
    <main className="screen game">
      <header className="topbar">
        <div className="topbar-center">
          <Brand music={false} />
          <div className="sound">
            <button
              className="mute ghost"
              aria-label={muted ? 'Unmute game audio' : 'Mute game audio'}
              title={muted ? 'Unmute' : 'Mute'}
              aria-pressed={muted}
              onClick={() => {
                stemPlayer.setMuted(!muted);
                setMuted(!muted);
              }}
            >
              <SpeakerIcon muted={muted} size={24} />
            </button>
            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                stemPlayer.setVolume(v);
                if (muted) {
                  stemPlayer.setMuted(false);
                  setMuted(false);
                }
              }}
            />
          </div>
        </div>
        <button className="ghost small end-game" onClick={onLeave}>
          End
        </button>
      </header>

      <section className="stage card">
        <h2 className="stage-room">
          Room <span>{room.code}</span>
        </h2>
        {room.library === 'local' && <p className="source-chip">🎵 Host's music</p>}
        {phase === 'prepare' && (
          <>
            <p className="status">Get ready…</p>
            {transfer && (
              <p className="muted small prepare-detail">
                Loading songs: {transfer.ready}/{transfer.total} players ready
              </p>
            )}
          </>
        )}
        {phase === 'playing' && secondsLeft !== null && (
          <p className={`countdown ${secondsLeft <= 5 ? 'urgent' : ''}`} aria-label="Time left in round">
            {formatTime(secondsLeft)}
          </p>
        )}
        {phase === 'playing' && (
          <>
            <span className="now-playing" aria-hidden>
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <p className="status">
              {me?.attempted ? 'Answer locked in. Waiting for others…' : 'Which song is this? You get one pick.'}
            </p>
          </>
        )}
        {result && (
          <div className="answer">
            <p className="muted small">The song was</p>
            <h2>
              {answer.title}
              {answer.artist && ` - ${answer.artist}`}
            </h2>
            <p className={roundWinners.length ? 'round-winners' : 'round-winners none'}>
              {me && answer.points[me.name]
                ? `Correct! +${pointsLabel(answer.points[me.name])}`
                : roundWinners.length
                  ? `${roundWinners.map((name) => `${name} (+${answer.points[name]})`).join(', ')} got it.`
                  : 'Nobody got this one'}
              {choice !== null && choice !== answer.correct && <span className="wrong-guess"> · Your pick was wrong.</span>}
            </p>
          </div>
        )}

        {options.length > 0 && (
          <div className="options" role="group" aria-label="Answer options">
            {options.map((title, i) => (
              <button key={`${i}-${title}`} className={optionClass(i)} disabled={!canPick} onClick={() => void pick(i)}>
                {title}
              </button>
            ))}
          </div>
        )}

        {result && room.state !== 'finished' && nextIn !== null && (
          <p className="status muted">
            {answer.isLast ? 'Final results' : 'Next song'} in {nextIn}…
          </p>
        )}
        {hint && <p className="hint">{hint}</p>}
      </section>

      <aside className="side">
        <div className="card">
          <h3>Players</h3>
          <Scoreboard room={room} meId={meId} />
        </div>
        <div className="card">
          <h3>Guesses</h3>
          <ul className="feed" ref={feedRef}>
            {feed.map((item) => (
              <li key={item.id} className={item.type}>
                {item.type === 'system' && item.text}
                {item.type === 'correct' &&
                  `${item.name} correctly guessed the song "${item.text}"!${item.points ? ` +${pointsLabel(item.points)}` : ''}`}
                {item.type === 'nobody' && 'Nobody got this one'}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </main>
  );
}
