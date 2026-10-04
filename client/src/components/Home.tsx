import { useState, type FormEvent } from 'react';
import { stemPlayer } from '../audio';
import { request } from '../socket';

const NAME_KEY = 'stemguess:name';

export default function Home({ connected }: { connected: boolean }) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: 'create_room' | 'join_room') {
    // Must run inside the click handler so mobile browsers allow audio later.
    stemPlayer.unlock();
    setBusy(true);
    setError('');
    localStorage.setItem(NAME_KEY, name.trim());
    const ack = await request(event, { name, code });
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
      <div className="card narrow">
        <h1 className="logo">
          Stem<span>Guess</span>
        </h1>
        <p className="muted">Name the song from its instruments. One stem at a time.</p>

        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. Anu" />
        </label>

        <button className="primary" disabled={!connected || !nameOk || busy} onClick={() => void submit('create_room')}>
          Create room
        </button>

        <div className="divider">or join one</div>

        <form className="row" onSubmit={onJoin}>
          <input
            className="code-input"
            value={code}
            maxLength={4}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="CODE"
          />
          <button type="submit" disabled={!connected || !nameOk || code.length !== 4 || busy}>
            Join
          </button>
        </form>

        {error && <p className="error">{error}</p>}
        {!connected && <p className="muted small">Connecting to server…</p>}
      </div>
    </main>
  );
}
