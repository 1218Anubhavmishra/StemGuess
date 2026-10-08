import { useEffect, useRef, useState, type FormEvent } from 'react';
import { stemPlayer } from '../audio';
import { request } from '../socket';
import type { FeedItem, Phase, RoomState, StemInfo } from '../types';
import Scoreboard from './Scoreboard';

type Props = {
  room: RoomState;
  meId: string;
  phase: Phase;
  stems: StemInfo[];
  revealed: number;
  endsAt: number | null;
  answer: { title: string; artist: string; isLast: boolean } | null;
  feed: FeedItem[];
  isHost: boolean;
  onLeave: () => void;
};

function useCountdown(endsAt: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [endsAt]);
  return endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : null;
}

const formatTime = (seconds?: number) =>
  seconds === undefined ? '--:--' : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function SongProgress({ complete }: { complete: boolean }) {
  const [progress, setProgress] = useState(stemPlayer.progress());
  const lastDuration = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (complete) return;
    let frame = 0;
    const tick = () => {
      const p = stemPlayer.progress();
      if (p) lastDuration.current = p.duration;
      setProgress(p);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [complete]);

  const duration = complete ? lastDuration.current : progress?.duration;
  const position = complete ? lastDuration.current : progress?.position;
  const percent = complete ? 100 : progress ? (progress.position / progress.duration) * 100 : 0;
  return (
    <div className="progress" role="progressbar" aria-label="Song progress" aria-valuenow={Math.round(percent)}>
      <span>{formatTime(position)}</span>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <span>{formatTime(duration)}</span>
    </div>
  );
}

export default function Game({ room, meId, phase, stems, revealed, endsAt, answer, feed, isHost, onLeave }: Props) {
  const [guess, setGuess] = useState('');
  const [hint, setHint] = useState('');
  const [volume, setVolume] = useState(stemPlayer.getVolume());
  const feedRef = useRef<HTMLUListElement>(null);
  const secondsLeft = useCountdown(endsAt);
  const me = room.players.find((p) => p.id === meId);
  const roundWinners = room.players.filter((p) => p.guessed).map((p) => p.name);
  const canGuess = phase === 'playing' && revealed > 0 && !me?.attempted;

  useEffect(() => setHint(''), [room.round]);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [feed]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = guess.trim();
    if (!text) return;
    setGuess('');
    const ack = await request('guess', { text });
    if (ack.result === 'correct') setHint('Correct! You got it.');
    else if (ack.result === 'close') setHint(`"${text}" was close, but not quite. That was your guess for this round.`);
    else if (ack.result === 'wrong') setHint(`"${text}" isn't it.`);
    else if (ack.error) setHint(ack.error);
  }

  return (
    <main className="screen game">
      <header className="topbar">
        <button className="ghost small end-game" onClick={onLeave}>
          End
        </button>
      </header>

      <section className="stage card">
        <h2 className="stage-room">
          Room <span>{room.code}</span>
        </h2>
        {phase === 'prepare' && <p className="status">Get ready… loading stems</p>}
        {phase === 'playing' && secondsLeft !== null && (
          <p className={`countdown ${secondsLeft <= 5 ? 'urgent' : ''}`} aria-label="Time left in round">
            {formatTime(secondsLeft)}
          </p>
        )}
        {phase === 'playing' && (
          <p className="status">
            {me?.guessed
              ? 'You got it! Waiting for others…'
              : me?.attempted
                ? 'Guess used. Waiting for others…'
                : 'Listen and guess the song: you get one guess'}
          </p>
        )}
        {phase === 'roundEnd' && answer && (
          <div className="answer">
            <p className="muted small">The song was</p>
            <h2>
              {answer.title}
              {answer.artist && ` - ${answer.artist}`}
            </h2>
            <p className={roundWinners.length ? 'round-winners' : 'round-winners none'}>
              {roundWinners.length ? `Got it: ${roundWinners.join(', ')}` : 'Nobody got this one'}
            </p>
          </div>
        )}

        <SongProgress complete={phase === 'roundEnd'} />

        <ul className="stems">
          {stems.map((s, i) => (
            <li key={s.url} className={i < revealed ? 'on' : ''}>
              <span className="bars" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              {i < revealed ? s.name.replace(/_/g, ' ') : '?'}
            </li>
          ))}
        </ul>

        {room.state === 'finished' ? null : phase === 'roundEnd' ? (
          isHost ? (
            <button className="primary" onClick={() => void request('next_round')}>
              {answer?.isLast ? 'See results' : 'Next'}
            </button>
          ) : (
            <p className="status muted">Waiting for the host to continue…</p>
          )
        ) : (
          <form className="row guess" onSubmit={submit}>
            <input
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              placeholder={canGuess ? 'Type the song title (one guess)…' : ''}
              disabled={!canGuess}
              autoFocus
            />
            <button type="submit" className="primary" disabled={!canGuess || !guess.trim()}>
              Guess
            </button>
          </form>
        )}
        {hint && <p className="hint">{hint}</p>}
      </section>

      <label className="volume">
        Vol
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => {
            const v = Number(e.target.value);
            setVolume(v);
            stemPlayer.setVolume(v);
          }}
        />
      </label>

      <aside className="side">
        <div className="card">
          <h3>Players</h3>
          <Scoreboard room={room} meId={meId} showGuessed />
        </div>
        <div className="card">
          <h3>Guesses</h3>
          <ul className="feed" ref={feedRef}>
            {feed.map((item) => (
              <li key={item.id} className={item.type}>
                {item.type === 'system' && item.text}
                {item.type === 'correct' && `${item.name} guessed the song!`}
                {item.type === 'guess' && (
                  <>
                    <b>{item.name}:</b> {item.text}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </main>
  );
}
