import { useState } from 'react';
import { request } from '../socket';
import type { Player, RoomState } from '../types';

type Props = { room: RoomState; ranking: Player[]; isHost: boolean; onLeave: () => void };

export default function GameOver({ room, ranking, isHost, onLeave }: Props) {
  const [error, setError] = useState('');
  const top = ranking[0]?.score ?? 0;

  async function playAgain() {
    setError('');
    const ack = await request('start_game');
    if (!ack.ok) setError(ack.error ?? 'Could not start');
  }

  return (
    <main className="screen center">
      <div className="card narrow">
        <h1>Final scores</h1>
        <ol className="ranking">
          {ranking.map((p, i) => (
            <li key={p.id} className={p.score === top && top > 0 ? 'winner' : ''}>
              <span className="place">{i + 1}</span>
              <span className="name">{p.name}</span>
              <span className="score">
                {p.score} / {room.totalRounds}
              </span>
            </li>
          ))}
        </ol>
        {isHost ? (
          <button className="primary" onClick={() => void playAgain()}>
            Play again
          </button>
        ) : (
          <p className="muted">Waiting for the host…</p>
        )}
        {error && <p className="error">{error}</p>}
        <button className="ghost" onClick={onLeave}>
          Leave room
        </button>
      </div>
    </main>
  );
}
