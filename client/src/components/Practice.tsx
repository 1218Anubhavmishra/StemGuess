import { useEffect, useRef, useState } from 'react';
import { stemPlayer, unlockAudio } from '../audio';
import { clipOf } from '../localLibrary';
import { request, serverUrl } from '../socket';
import { SONG_LIMITS, type Credit, type Library, type ServerLibrary } from '../types';
import Brand from './Brand';
import CreditLine from './CreditLine';
import { LibraryTabs, LocalPicker, OPTIONS, useLocalTracks } from './SongSource';

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

/** Solo practice: one song at a time from any library, no room or other players needed. */
export default function Practice({ connected, onBack }: { connected: boolean; onBack: () => void }) {
  const [library, setLibrary] = useState<Library>('demo');
  const [libraries, setLibraries] = useState<Record<ServerLibrary, number> | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [score, setScore] = useState({ right: 0, played: 0 });
  // Songs already played this session, so they don't come up again until the library runs out.
  const seen = useRef<Record<string, (number | string)[]>>({});
  const tracks = useLocalTracks();
  const local = library === 'local';

  useEffect(() => {
    if (connected) void request('library').then((ack) => ack.ok && setLibraries(ack.libraries ?? null));
  }, [connected]);

  useEffect(() => () => stemPlayer.stop(), []);

  function choose(next: Library) {
    stemPlayer.stop();
    setLibrary(next);
    setRound(null);
    setChoice(null);
    setError('');
    setScore({ right: 0, played: 0 });
  }

  async function nextLocal(): Promise<Round | null> {
    if (tracks.length < 2) {
      setError('Pick at least 2 songs to practise with.');
      return null;
    }
    const played = (seen.current.local ??= []);
    const fresh = tracks.filter((t) => !played.includes(t.id));
    const pool = fresh.length ? fresh : tracks;
    if (!fresh.length) played.length = 0;
    const track = pool[Math.floor(Math.random() * pool.length)];
    played.push(track.id);
    const others = [...new Set(tracks.map((t) => t.title).filter((t) => t.toLowerCase() !== track.title.toLowerCase()))];
    const options = shuffled([track.title, ...shuffled(others).slice(0, OPTION_COUNT - 1)]);
    stemPlayer.prepareClip(clipOf(track));
    return { options, correct: options.indexOf(track.title), title: track.title, artist: track.artist };
  }

  async function nextServer(): Promise<Round | null> {
    const played = (seen.current[library] ??= []);
    const ack = await request('practice_round', { library, exclude: played });
    if (!ack.ok || !ack.round) {
      setError(ack.error ?? 'Could not load a song');
      return null;
    }
    if (played.includes(ack.round.id)) played.length = 0;
    played.push(ack.round.id);
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

  const selected = OPTIONS.find((o) => o.id === library) ?? OPTIONS[0];
  const optionClass = (i: number) =>
    [
      'option',
      choice !== null && i === round?.correct ? 'right' : '',
      choice !== null && i === choice && i !== round?.correct ? 'wrong' : '',
    ]
      .filter(Boolean)
      .join(' ');

  return (
    <main className="screen center">
      <div className="home-stack practice">
        <Brand music={false} />
        <div className="card narrow">
          <h2 className="practice-head">Play Library</h2>
          <LibraryTabs value={library} libraries={libraries} minSongs={SONG_LIMITS.min} onChange={choose} />
          <p className="notice small">{selected.notice}</p>
          {local && <LocalPicker />}
          <p className="muted small">
            Practise on your own: listen, pick the song, then go to the next one. Scores here don't count in games.
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

          <button className="ghost leave-room back" onClick={onBack}>
            <span className="arrow" aria-hidden>
              ←
            </span>
            Back
          </button>
        </div>
      </div>
    </main>
  );
}
