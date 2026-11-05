import type { RoomState } from '../types';
import DisconnectedIcon from './DisconnectedIcon';

/** Player list during a game. Scores stay hidden until the final results. */
export default function Scoreboard({ room, meId }: { room: RoomState; meId: string }) {
  return (
    <ul className="scoreboard">
      {room.players.map((p) => (
        <li key={p.id} className={!p.connected ? 'gone' : p.id === meId ? 'me' : ''}>
          <span className="name">
            {p.name}
            {p.id === room.hostId && <span className="tag">host</span>}
            {room.state === 'playing' && p.attempted && <span className="tag">answered</span>}
            {!p.connected && <DisconnectedIcon />}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The lobby's numbered seats: one per allowed player, empty until someone joins or while they're offline. */
export function PlayerSlots({ room, meId }: { room: RoomState; meId: string }) {
  const seats = Math.max(room.maxPlayers, room.players.length);
  return (
    <ol className="player-slots">
      {Array.from({ length: seats }, (_, i) => {
        const p = room.players[i];
        if (!p?.connected) return <li key={`empty-${i}`} className="empty" aria-label="Empty" />;
        return (
          <li key={p.id} className={p.id === meId ? 'me' : ''}>
            {p.name}
            {p.id === room.hostId && <span className="tag">host</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** A box listing who's watching. Not shown when nobody is. */
export function Spectators({ room, meId, className }: { room: RoomState; meId: string; className: string }) {
  const watching = room.spectators ?? [];
  if (!watching.length) return null;
  return (
    <div className={className}>
      <h3>Spectators</h3>
      <ul className="scoreboard">
        {watching.map((s) => (
          <li key={s.id} className={s.id === meId ? 'me' : ''}>
            {s.name}
            {s.id === meId && ' (you)'}
          </li>
        ))}
      </ul>
    </div>
  );
}
