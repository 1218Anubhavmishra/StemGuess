import { useState, type FormEvent } from 'react';
import { unlockAudio } from '../audio';
import { request } from '../socket';
import { PLAYER_LIMITS } from '../types';
import CodeInput from './CodeInput';
import MusicToggle from './MusicToggle';
import Stepper from './Stepper';

const NAME_KEY = 'stemguess:name';

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
    if (!ack.ok) setError(ack.error ?? 'Something went wrong');
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
        <header className="brand">
          <h1 className="logo">
            Stem<span>Guess</span>
          </h1>
          <MusicToggle />
        </header>

        <div className="card narrow">
          <p className="muted">Guess Songs with their instruments.</p>

          <label className="field inline">
            <span>Host name (you)</span>
            <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. Anu" />
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

          <div className="divider">or join one</div>

          <form className="row join-row" onSubmit={onJoin}>
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
