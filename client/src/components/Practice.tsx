import { useEffect, useRef, useState } from 'react';
import { stemPlayer, unlockAudio } from '../audio';
import { clipOf } from '../localLibrary';
import { request, serverUrl } from '../socket';
import type { Credit, Library } from '../types';
import CreditLine from './CreditLine';
import { useLocalTracks } from './SongSource';

type Round = { options: string[]; correct: number; title: string; artist: string; credit?: Credit | null };

const OPTION_COUNT = 4;

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Solo practice: one random song at a time from a library; pick its title. Remount per library. */
export default function Practice({ library, connected }: { library: Library; connected: boolean }) {
  const [round, setRound] = useState<Round | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [score, setScore] = useState({ right: 0, played: 0 });
  // Songs already played, so they don't come up again until the library runs out.
  const seen = useRef<(number | string)[]>([]);
  const tracks = useLocalTracks();
  const local = library === 'local';

  useEffect(() => () => stemPlayer.stop(), []);

  async function nextLocal(): Promise<Round | null> {
    if (tracks.length < 2) {
      setError('Pick at least 2 songs to practise with.');
      return null;
    }
    const fresh = tracks.filter((t) => !seen.current.includes(t.id));
    if (!fresh.length) seen.current = [];
    const pool = fresh.length ? fresh : tracks;
    const track = pool[Math.floor(Math.random() * pool.length)];
    seen.current.push(track.id);
    const others = [...new Set(tracks.map((t) => t.title).filter((t) => t.toLowerCase() !== track.title.toLowerCase()))];
    const options = shuffled([track.title, ...shuffled(others).slice(0, OPTION_COUNT - 1)]);
    stemPlayer.prepareClip(clipOf(track));
    return { options, correct: options.indexOf(track.title), title: track.title, artist: track.artist };
  }

  async function nextServer(): Promise<Round | null> {
    const ack = await request('practice_round', { library, exclude: seen.current });
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
    const r = await (local ? nextLocal() : nextServer());
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
      <p className="muted small">
        Listen to a random song and pick its title, then go to the next one. Scores here don't count in games.
      </p>
      {round && (
        <>
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
          <div className="options" role="group" aria-label="Answer options">
            {round.options.map((title, i) => (
              <button key={`${i}-${title}`} className={optionClass(i)} disabled={choice !== null} onClick={() => pick(i)}>
                {title}
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p className="error small">{error}</p>}
      <div className="row practice-actions">
        {score.played > 0 && (
          <span className="muted small" role="status">
            {score.right}/{score.played} correct
          </span>
        )}
        {round && choice === null && !loading ? (
          <button onClick={() => void next()}>Skip</button>
        ) : (
          <button className="primary" disabled={loading || (!local && !connected)} onClick={() => void next()}>
            {loading ? 'Loading…' : round ? 'Next song' : 'Play a song'}
          </button>
        )}
      </div>
    </>
  );
}
