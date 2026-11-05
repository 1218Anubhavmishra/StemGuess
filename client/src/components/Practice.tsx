import { useEffect, useRef, useState } from 'react';
import { stemPlayer, unlockAudio } from '../audio';
import { type SongFilters } from '../filters';
import { request, serverUrl } from '../socket';
import type { Credit, Library } from '../types';
import { CoverBackdrop, RingedCover } from './Cover';
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
  // The answer last revealed. It stays in its folded-away box, so folding it doesn't cut it off.
  const [shownAnswer, setShownAnswer] = useState<{ round: Round; right: boolean } | null>(null);
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
    setShownAnswer({ round, right: i === round.correct });
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
          <div className="practice-answer" inert={choice === null}>
            {shownAnswer && (
              <div className="answer">
                <p className={shownAnswer.right ? 'round-winners' : 'round-winners none'}>
                  {shownAnswer.right ? 'Correct!' : 'Not this time.'}
                </p>
                <h2>
                  {shownAnswer.round.title}
                  {shownAnswer.round.artist && ` - ${shownAnswer.round.artist}`}
                </h2>
                {shownAnswer.round.credit && <CreditLine credit={shownAnswer.round.credit} />}
              </div>
            )}
          </div>
          {/* The cover stays the game's icon until you answer, so it doesn't give the song away. */}
          <div className="practice-player">
            {/* The cover stays centred, with the button for the next song to its right. */}
            <div className="practice-cover-row">
              <RingedCover credit={round.credit} revealed={choice !== null} />
              <button
                className="practice-next"
                aria-label={choice === null ? 'Skip this song' : 'Next song'}
                title={choice === null ? 'Skip' : 'Next'}
                disabled={loading || !connected}
                onClick={() => void next()}
              >
                <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M4 12h16M13 5l7 7-7 7" />
                </svg>
              </button>
            </div>
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
          <p className="practice-score muted small" role="status">
            {score.right}/{score.played} correct
          </p>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
      {/* Starts the first song; after that, the button is beside the cover. */}
      {!round && (
        <div className="practice-actions">
          <button className="primary" disabled={loading || !connected} onClick={() => void next()}>
            {loading ? 'Loading…' : 'Play'}
          </button>
        </div>
      )}
    </>
  );
}
