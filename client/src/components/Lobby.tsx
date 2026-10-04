import { useState } from 'react';
import { request, socket } from '../socket';
import type { RoomState } from '../types';
import Scoreboard from './Scoreboard';

const ROUND_OPTIONS = [3, 5, 10];

export default function Lobby({ room, isHost, onLeave }: { room: RoomState; isHost: boolean; onLeave: () => void }) {
  const [rounds, setRounds] = useState(5);
  const [error, setError] = useState('');

  async function start() {
    setError('');
    const ack = await request('start_game', { rounds });
    if (!ack.ok) setError(ack.error ?? 'Could not start');
  }

  return (
    <main className="screen center">
      <div className="card narrow">
        <p className="muted small">Room code</p>
        <h1 className="room-code">{room.code}</h1>
        <p className="muted small">Share this code with your friends.</p>

        <h3>Players ({room.players.length})</h3>
        <Scoreboard room={room} meId={socket.id ?? ''} />

        {isHost ? (
          <>
            <div className="field">
              <span>Rounds</span>
              <div className="segmented">
                {ROUND_OPTIONS.map((n) => (
                  <button key={n} className={n === rounds ? 'active' : ''} onClick={() => setRounds(n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <button className="primary" onClick={() => void start()}>
              Start game
            </button>
          </>
        ) : (
          <p className="muted">Waiting for the host to start…</p>
        )}

        {error && <p className="error">{error}</p>}
        <button className="ghost" onClick={onLeave}>
          Leave room
        </button>
      </div>
    </main>
  );
}
