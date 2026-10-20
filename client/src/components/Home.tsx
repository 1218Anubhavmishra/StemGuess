import { useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { unlockAudio } from '../audio';
import { request, saveSession } from '../socket';
import { PLAYER_LIMITS } from '../types';
import CodeInput from './CodeInput';
import Brand from './Brand';
import Stepper from './Stepper';

const NAME_KEY = 'stemguess:name';
const NAME_LIMIT = 28;

export default function Home({ connected, menu }: { connected: boolean; menu: ReactNode }) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '');
  const [maxPlayers, setMaxPlayers] = useState(PLAYER_LIMITS.min);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [canSpectate, setCanSpectate] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const roomCode = code.replace(/ /g, '');

  async function submit(event: 'create_room' | 'join_room', spectate = false) {
    // The buttons stay enabled so a tap explains what's missing instead of doing nothing.
    if (!nameOk) {
      setError(event === 'join_room' ? 'Enter your name above to join' : 'Enter your name first');
      nameRef.current?.focus();
      return;
    }
    if (event === 'join_room' && roomCode.length !== 4) {
      setError('Enter the 4-character room code');
      return;
    }
    unlockAudio();
    setBusy(true);
    setError('');
    setCanSpectate(false);
    localStorage.setItem(NAME_KEY, name.trim());
    const ack = await request(event, { name, code: roomCode, maxPlayers, spectate });
    if (ack.ok) saveSession(ack);
    else {
      setError(ack.error ?? 'Something went wrong');
      setCanSpectate(!!ack.canSpectate);
    }
    setBusy(false);
  }

  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    void submit('join_room');
  };

  const nameOk = name.trim().length > 0;

  return (
    <main className="screen center">
      <div className="home-stack">
        <Brand />

        <div className="card narrow">

          <label className="field">
            <span>Host name (you)</span>
            <span className="slot-wrap">
              <input
                ref={nameRef}
                className="slots name-input"
                style={{ '--n': NAME_LIMIT } as CSSProperties}
                value={name}
                placeholder="type your name here to enter"
                maxLength={NAME_LIMIT}
                spellCheck={false}
                onChange={(e) => setName(e.target.value.slice(0, NAME_LIMIT))}
              />
            </span>
          </label>

          <div className="row create-row">
            <Stepper
              label="Max players"
              inline
              value={maxPlayers}
              min={PLAYER_LIMITS.min}
              max={PLAYER_LIMITS.max}
              onChange={setMaxPlayers}
            />
            <button className="primary" disabled={!connected || busy} onClick={() => void submit('create_room')}>
              Create Room
            </button>
          </div>

          <form className="row join-row" onSubmit={onJoin}>
            <span className="divider">or join one</span>
            <CodeInput value={code} length={4} onChange={setCode} />
            <button type="submit" disabled={!connected || busy}>
              Join
            </button>
          </form>

          {error && <p className="error">{error}</p>}
          {canSpectate && (
            <button className="primary" disabled={busy} onClick={() => void submit('join_room', true)}>
              Spectate
            </button>
          )}
          {!connected && <p className="muted small">Connecting to server…</p>}
        </div>
        {menu}
      </div>
    </main>
  );
}
