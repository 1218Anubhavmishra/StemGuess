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
  answer: { title: string; artist: string } | null;
  feed: FeedItem[];
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

export default function Game({ room, meId, phase, stems, revealed, endsAt, answer, feed, onLeave }: Props) {
  const [guess, setGuess] = useState('');
  const [hint, setHint] = useState('');
  const [volume, setVolume] = useState(stemPlayer.getVolume());
  const feedRef = useRef<HTMLUListElement>(null);
  const secondsLeft = useCountdown(endsAt);
  const me = room.players.find((p) => p.id === meId);
  const canGuess = phase === 'playing' && revealed > 0 && !me?.guessed;

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
    if (ack.result === 'correct') setHint('Correct! +1 point');
    else if (ack.result === 'close') setHint(`"${text}" is close!`);
    else if (ack.result === 'wrong') setHint('');
    else if (ack.error) setHint(ack.error);
  }

  return (
    <main className="screen game">
      <header className="topbar">
        <span className="pill">Room {room.code}</span>
        <span className="pill">
          Round {room.round}/{room.totalRounds}
        </span>
        <span className={`pill timer ${secondsLeft !== null && secondsLeft <= 5 ? 'urgent' : ''}`}>
          {secondsLeft ?? '–'}s
        </span>
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
        <button className="ghost small" onClick={onLeave}>
          Leave
        </button>
      </header>

      <section className="stage card">
        {phase === 'prepare' && <p className="status">Get ready… loading stems</p>}
        {phase === 'playing' && (
          <p className="status">{me?.guessed ? 'You got it! Waiting for others…' : 'Listen and guess the song'}</p>
        )}
        {phase === 'roundEnd' && answer && (
          <div className="answer">
            <p className="muted small">The song was</p>
            <h2>{answer.title}</h2>
            {answer.artist && <p className="muted">{answer.artist}</p>}
          </div>
        )}

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

        <form className="row guess" onSubmit={submit}>
          <input
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            placeholder={canGuess ? 'Type the song title…' : ''}
            disabled={!canGuess}
            autoFocus
          />
          <button type="submit" className="primary" disabled={!canGuess || !guess.trim()}>
            Guess
          </button>
        </form>
        {hint && <p className="hint">{hint}</p>}
      </section>

      <aside className="side">
        <div className="card">
          <h3>Scores</h3>
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
