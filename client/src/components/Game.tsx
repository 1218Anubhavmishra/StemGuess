import { useEffect, useState } from 'react';
import { request } from '../socket';
import type { Phase, RoomState, RoundAnswer } from '../types';
import Brand from './Brand';
import { CoverBackdrop, RingedCover } from './Cover';
import CreditLine from './CreditLine';
import { WindowBody } from './ScrollHints';

type Props = {
  room: RoomState;
  meId: string;
  phase: Phase;
  options: string[];
  choice: number | null;
  onPick: (option: number) => void;
  endsAt: number | null;
  answer: RoundAnswer | null;
  roundCount: { round: number; total: number } | null;
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
  answer,
  roundCount,
  onLeave,
}: Props) {
  const [hint, setHint] = useState('');
  const secondsLeft = useCountdown(endsAt);
  const me = room.players.find((p) => p.id === meId);
  const roundWinners = Object.keys(answer?.points ?? {});
  const canPick = phase === 'playing' && choice === null && !!me && !me.attempted;
  // During "Get ready" too, when the previous round went straight into it.
  const result = (phase === 'roundEnd' || phase === 'prepare') && answer;

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
        <p className="topbar-room">
          Room <span>{room.code}</span>
        </p>
        <div className="topbar-center">
          <Brand />
        </div>
        <button className="ghost small end-game" onClick={onLeave}>
          End
        </button>
      </header>

      {/* After the reveal, the song's cover, blurred, fills the round window. */}
      <section className="stage card has-backdrop">
        {result && <CoverBackdrop credit={answer.credit} />}
        <WindowBody>
          <div className="round-body">
            {roundCount && (
              <p className="round-count muted small">
                Round {roundCount.round} of {roundCount.total}
                {phase === 'prepare' && result && ' · Get ready…'}
              </p>
            )}
            {phase === 'prepare' && !result && <p className="status">Get ready…</p>}
            {phase === 'playing' && secondsLeft !== null && (
              <p className={`countdown ${secondsLeft <= 5 ? 'urgent' : ''}`} aria-label="Time left in round">
                {formatTime(secondsLeft)}
              </p>
            )}
            {phase === 'playing' && (
              <p className="status">
                {me?.attempted ? 'Answer locked in. Waiting for others…' : 'This song is ...'}
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
                      ? `${roundWinners.length} player${roundWinners.length === 1 ? '' : 's'} got it.`
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
            {hint && <p className="hint">{hint}</p>}
          </div>
        </WindowBody>
      </section>
    </main>
  );
}
