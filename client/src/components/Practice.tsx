import { useEffect, useRef, useState } from 'react';
import { stemPlayer, unlockAudio } from '../audio';
import { type SongFilters } from '../filters';
import { request, serverUrl } from '../socket';
import type { Credit, Library } from '../types';
import Cover, { CoverBackdrop } from './Cover';
import CreditLine from './CreditLine';
import { ProgressBar } from './Playback';

type Round = { title: string; artist: string; options: string[]; correct: number; credit?: Credit | null };

/** Solo practice: one random song at a time from a library; pick its title. Remount per library. */
export default function Practice({
  library,
  connected,
  filters,
}: {
  library: Library;
  connected: boolean;
  /** Only songs matching these come up. Remount when they change. */
  filters: SongFilters;
}) {
  const [round, setRound] = useState<Round | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [score, setScore] = useState({ right: 0, played: 0 });
  // Songs already played, so they don't come up again until the library runs out.
  const seen = useRef<number[]>([]);

  useEffect(() => () => stemPlayer.stop(), []);

  async function nextServer(): Promise<Round | null> {
    const ack = await request('practice_round', { library, exclude: seen.current, ...filters });
    if (!ack.ok || !ack.round) {
      setError(ack.error ?? 'Could not load a song');
      return null;
    }
    if (seen.current.includes(ack.round.id)) seen.current = [];
    seen.current.push(ack.round.id);
    stemPlayer.prepare(ack.round.urls.map(serverUrl));
    return ack.round;
  }

  async function next() {
    unlockAudio();
    stemPlayer.stop();
    setLoading(true);
    setError('');
    setChoice(null);
    const r = await nextServer();
    setRound(r);
    setLoading(false);
    if (r) void stemPlayer.start();
  }

  function pick(i: number) {
    if (!round || choice !== null) return;
    setChoice(i);
    setScore((s) => ({ right: s.right + (i === round.correct ? 1 : 0), played: s.played + 1 }));
  }

  const optionClass = (i: number) =>
    [
      'option',
      choice !== null && i === round?.correct ? 'right' : '',
      choice !== null && i === choice && i !== round?.correct ? 'wrong' : '',
    ]
      .filter(Boolean)
      .join(' ');

  return (
    <>
      {round && (
        // Once answered, the song's cover, blurred, fills the round's area.
        <div className={`practice-stage has-backdrop${choice !== null ? ' revealed' : ''}`}>
          {choice !== null && <CoverBackdrop credit={round.credit} />}
          {choice === null ? (
            <span className="now-playing" aria-hidden>
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          ) : (
            <div className="answer">
              <p className={choice === round.correct ? 'round-winners' : 'round-winners none'}>
                {choice === round.correct ? 'Correct!' : 'Not this time.'}
              </p>
              <h2>
                {round.title}
                {round.artist && ` - ${round.artist}`}
              </h2>
              {round.credit && <CreditLine credit={round.credit} />}
            </div>
          )}
          {/* The cover stays a "?" until you answer, so it doesn't give the song away. */}
          <div className="practice-player">
            <Cover credit={round.credit} hidden={choice === null} />
            <ProgressBar />
          </div>
          <div className="options" role="group" aria-label="Answer options">
            {round.options.map((title, i) => (
              <button
                key={`${i}-${title}`}
                className={optionClass(i)}
                disabled={choice !== null}
                onClick={() => pick(i)}
              >
                {title}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
      {/* The button centred, with the score under it. */}
      <div className="practice-actions">
        {round && choice === null && !loading ? (
          <button onClick={() => void next()}>Skip</button>
        ) : (
          <button className="primary" disabled={loading || !connected} onClick={() => void next()}>
            {loading ? 'Loading…' : round ? 'Next' : 'Play'}
          </button>
        )}
        {score.played > 0 && (
          <span className="muted small" role="status">
            {score.right}/{score.played} correct
          </span>
        )}
      </div>
    </>
  );
}
