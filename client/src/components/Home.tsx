import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { unlockAudio } from '../audio';
import { NO_FILTERS, hasFilters, songFilter, tidySearch, type SongFilters } from '../filters';
import { request, saveSession } from '../socket';
import { PLAYER_LIMITS, SONG_LIMITS, type Library } from '../types';
import CodeInput from './CodeInput';
import Brand from './Brand';
import Filters, { useLibraryFacets } from './Filters';
import { WindowBody } from './ScrollHints';
import Stepper from './Stepper';

const NAME_KEY = 'stemguess:name';
const NAME_LIMIT = 20;
/** The library every new room starts with (the server's default). */
const LIBRARY: Library = 'hits';

/** The screens before a room: the main one (name, create or join), then Room Settings or Join Room. */
type Step = 'main' | 'settings' | 'join';

function Window({ children }: { children: ReactNode }) {
  return (
    <main className="screen center">
      <div className="home-stack">
        <Brand />
        <div className="card narrow">
          <WindowBody>{children}</WindowBody>
        </div>
      </div>
    </main>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="ghost back-button" onClick={onClick}>
      <span className="arrow" aria-hidden>
        ←
      </span>
      Back
    </button>
  );
}

export default function Home({ connected }: { connected: boolean }) {
  const [name, setName] = useState(() => (localStorage.getItem(NAME_KEY) ?? '').slice(0, NAME_LIMIT));
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '');
  const [step, setStep] = useState<Step>('main');
  const [maxPlayers, setMaxPlayers] = useState(PLAYER_LIMITS.min);
  const [filters, setFilters] = useState<SongFilters>(NO_FILTERS);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const facets = useLibraryFacets(LIBRARY, connected && step === 'settings', search);
  const roomCode = code.replace(/ /g, '');
  const nameOk = name.trim().length > 0;
  const matching = facets?.filter(songFilter(filters)).reduce((n, row) => n + row.songs, 0) ?? null;
  const tooFew = matching !== null && matching < SONG_LIMITS.min;

  function go(next: Step) {
    setError('');
    setStep(next);
  }

  /** From the main screen: the name comes first. The buttons stay enabled so a tap explains what's missing. */
  function next(target: 'settings' | 'join') {
    if (!nameOk) {
      setError('Enter your name first');
      nameRef.current?.focus();
      return;
    }
    localStorage.setItem(NAME_KEY, name.trim());
    go(target);
  }

  async function create() {
    unlockAudio();
    setBusy(true);
    setError('');
    const ack = await request('create_room', { name, maxPlayers });
    if (!ack.ok) {
      setError(ack.error ?? 'Something went wrong');
      setBusy(false);
      return;
    }
    const query = tidySearch(search);
    if (hasFilters(filters) || query) {
      const set = await request('update_settings', { ...filters, search: query });
      if (!set.ok) setError(set.error ?? 'Could not set the song filters');
    }
    saveSession(ack);
    setBusy(false);
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    if (roomCode.length !== 4) {
      setError('Enter the 4-character room code');
      return;
    }
    unlockAudio();
    setBusy(true);
    setError('');
    const ack = await request('join_room', { name, code: roomCode });
    if (ack.ok) saveSession(ack);
    else setError(ack.error ?? 'Something went wrong');
    setBusy(false);
  }

  const status = (
    <>
      {error && <p className="error">{error}</p>}
      {!connected && <p className="muted small">Connecting to server…</p>}
    </>
  );

  if (step === 'settings') {
    return (
      <Window>
        <h2 className="window-title">Room Settings</h2>
        <Stepper
          label="Room player count"
          inline
          value={maxPlayers}
          min={PLAYER_LIMITS.min}
          max={PLAYER_LIMITS.max}
          onChange={setMaxPlayers}
        />
        <div className="field">
          <span>Song Filters</span>
          <Filters facets={facets} value={filters} onChange={setFilters} search={{ value: search, onChange: setSearch }} />
          {matching !== null && (hasFilters(filters) || search.trim()) && (
            <p className={tooFew ? 'error small' : 'muted small'}>
              {matching} song{matching === 1 ? '' : 's'} match
              {tooFew ? `. A game needs at least ${SONG_LIMITS.min}.` : ''}
            </p>
          )}
        </div>
        <button className="primary" disabled={!connected || busy || tooFew} onClick={() => void create()}>
          Create Room
        </button>
        {status}
        <BackButton onClick={() => go('main')} />
      </Window>
    );
  }

  if (step === 'join') {
    return (
      <Window>
        <h2 className="window-title">Join Room</h2>
        <form className="join-form" onSubmit={join}>
          <label className="field">
            <span>Enter a Room Code</span>
            <CodeInput value={code} length={4} onChange={setCode} />
          </label>
          <button type="submit" className="primary" disabled={!connected || busy}>
            Join
          </button>
        </form>
        {status}
        <BackButton onClick={() => go('main')} />
      </Window>
    );
  }

  return (
    <Window>
      <label className="field inline name-field">
        <span>Player Name</span>
        <input
          ref={nameRef}
          className="name-input"
          value={name}
          placeholder="Type your name here"
          maxLength={NAME_LIMIT}
          spellCheck={false}
          onChange={(e) => setName(e.target.value.slice(0, NAME_LIMIT))}
        />
      </label>
      <div className="choice-row">
        <button className="primary" disabled={!connected} onClick={() => next('settings')}>
          Create Room
        </button>
        <span className="divider">or</span>
        <button className="primary" disabled={!connected} onClick={() => next('join')}>
          Join Room
        </button>
      </div>
      {status}
    </Window>
  );
}
