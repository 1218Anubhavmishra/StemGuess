import type { RoomState } from '../types';

export default function Scoreboard({ room, meId, showGuessed }: { room: RoomState; meId: string; showGuessed?: boolean }) {
  const players = [...room.players].sort((a, b) => b.score - a.score);
  return (
    <ul className="scoreboard">
      {players.map((p) => (
        <li key={p.id} className={[p.id === meId && 'me', showGuessed && p.guessed && 'guessed'].filter(Boolean).join(' ')}>
          <span className="name">
            {p.name}
            {p.id === room.hostId && <span className="tag">host</span>}
          </span>
          <span className="score">{p.score}</span>
        </li>
      ))}
    </ul>
  );
}
