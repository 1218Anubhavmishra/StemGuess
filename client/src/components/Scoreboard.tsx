import type { RoomState } from '../types';
import DisconnectedIcon from './DisconnectedIcon';

/** The players, as a row of name tags above a round's question. Scores stay hidden until the final results. */
export default function Scoreboard({ room, meId }: { room: RoomState; meId: string }) {
  return (
    <ul className="scoreboard" aria-label="Players">
      {room.players.map((p) => (
        <li key={p.id} className={!p.connected ? 'gone' : p.id === meId ? 'me' : ''}>
          <span className="name">
            {p.name}
            {p.id === room.hostId && <span className="tag">host</span>}
            {room.state === 'playing' && p.attempted && (
              <span className="answered" role="img" aria-label="answered">
                ✓
              </span>
            )}
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
