import { useEffect, useState } from 'react';
import { request } from '../socket';
import type { FeedItem, Phase, RoomState, RoundAnswer } from '../types';
import { BrandIcon } from './Brand';
import { CoverBackdrop, RingedCover } from './Cover';
import CreditLine from './CreditLine';
import Scoreboard, { Spectators } from './Scoreboard';
import { WindowBody } from './ScrollHints';

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
  onLeave: () => void;
};

function useCountdown(endsAt: number | null) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [endsAt]);
  // Read the clock while rendering: a stored timestamp is stale on the first render after endsAt changes.
  return endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : null;
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
  onLeave,
}: Props) {
  const [hint, setHint] = useState('');
  const secondsLeft = useCountdown(endsAt);
  const nextIn = useCountdown(nextAt);
  const me = room.players.find((p) => p.id === meId);
  const roundWinners = Object.keys(answer?.points ?? {});
  const spectating = !me;
  const canPick = phase === 'playing' && choice === null && !!me && !me.attempted;
  const result = phase === 'roundEnd' && answer;

  useEffect(() => setHint(''), [room.round]);

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
        <BrandIcon />
        <p className="topbar-room">
          Room <span>{room.code}</span>
        </p>
        <button className="ghost small end-game" onClick={onLeave}>
          End
        </button>
      </header>

      {/* After the reveal, the song's cover, blurred, fills the round window. */}
      <section className="stage card has-backdrop">
        {result && <CoverBackdrop credit={answer.credit} />}
        <WindowBody>
          {phase === 'prepare' && <p className="status">Get ready…</p>}
          {phase === 'playing' && secondsLeft !== null && (
            <p className={`countdown ${secondsLeft <= 5 ? 'urgent' : ''}`} aria-label="Time left in round">
              {formatTime(secondsLeft)}
            </p>
          )}
          {phase === 'playing' && (
            <p className="status">
              {spectating
                ? "You're spectating. You'll join as a player after this game."
                : me.attempted
                  ? 'Answer locked in. Waiting for others…'
                  : 'Which song is this? You get one pick.'}
            </p>
          )}
          {result && (
            <div className="answer">
              <p className="muted small">The song was</p>
              <h2>
                {answer.title}
                {answer.artist && ` - ${answer.artist}`}
              </h2>
              {answer.credit && <CreditLine credit={answer.credit} />}
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

          {/* The song's cover stays the game's icon until the reveal. */}
          <RingedCover credit={result ? answer.credit : null} revealed={!!result} />

          {options.length > 0 && (
            <div className="options" role="group" aria-label="Answer options">
              {options.map((title, i) => (
                <button
                  key={`${i}-${title}`}
                  className={optionClass(i)}
                  disabled={!canPick}
                  onClick={() => void pick(i)}
                >
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
        </WindowBody>
      </section>

      <aside className="side">
        <div className="card">
          <WindowBody>
            <h3>Players</h3>
            <Scoreboard room={room} meId={meId} />
          </WindowBody>
        </div>
        <Spectators room={room} meId={meId} className="card" />
        <div className="card guesses">
          <WindowBody follow={feed.length}>
            <h3>Guesses</h3>
            <ul className="feed">
              {feed.map((item) => (
                <li key={item.id} className={item.type}>
                  {item.type === 'system' && item.text}
                  {item.type === 'correct' && `${item.name} guessed it!`}
                  {item.type === 'nobody' && 'Nobody got this one'}
                </li>
              ))}
            </ul>
          </WindowBody>
        </div>
      </aside>
    </main>
  );
}
