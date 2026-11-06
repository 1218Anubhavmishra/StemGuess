import type { RoomState } from '../types';

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
