import { useState, type CSSProperties, type FormEvent } from 'react';
import { unlockAudio } from '../audio';
import { request, saveSession } from '../socket';
import { PLAYER_LIMITS } from '../types';
import CodeInput from './CodeInput';
import Brand from './Brand';
import Stepper from './Stepper';

const NAME_KEY = 'stemguess:name';
const NAME_LIMIT = 20;

export default function Home({ connected }: { connected: boolean }) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '');
  const [maxPlayers, setMaxPlayers] = useState(PLAYER_LIMITS.min);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const roomCode = code.replace(/ /g, '');

  async function submit(event: 'create_room' | 'join_room') {
    unlockAudio();
    setBusy(true);
    setError('');
    localStorage.setItem(NAME_KEY, name.trim());
    const ack = await request(event, { name, code: roomCode, maxPlayers });
    if (ack.ok) saveSession(ack);
    else setError(ack.error ?? 'Something went wrong');
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

          <label className="field inline">
            <span>Host name (you)</span>
            <span className="slot-wrap">
              <input
                className="slots name-input"
                style={{ '--n': NAME_LIMIT } as CSSProperties}
                value={name}
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
            <button className="primary" disabled={!connected || !nameOk || busy} onClick={() => void submit('create_room')}>
              Create Room
            </button>
          </div>

          <form className="row join-row" onSubmit={onJoin}>
            <span className="divider">or join one</span>
            <CodeInput value={code} length={4} onChange={setCode} />
            <button type="submit" disabled={!connected || !nameOk || roomCode.length !== 4 || busy}>
              Join
            </button>
          </form>

          {error && <p className="error">{error}</p>}
          {!connected && <p className="muted small">Connecting to server…</p>}
        </div>
      </div>
    </main>
  );
}
