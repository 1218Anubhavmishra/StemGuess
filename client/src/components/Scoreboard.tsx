import type { RoomState } from '../types';
import DisconnectedIcon from './DisconnectedIcon';

/** Player list. Scores stay hidden until the final results. */
export default function Scoreboard({ room, meId }: { room: RoomState; meId: string }) {
  return (
    <ul className="scoreboard">
      {room.players.map((p) => (
        <li key={p.id} className={!p.connected ? 'gone' : p.id === meId ? 'me' : ''}>
          <span className="name">
            {p.name}
            {p.id === room.hostId && <span className="tag">host</span>}
            {!p.connected && <DisconnectedIcon />}
          </span>
        </li>
      ))}
    </ul>
  );
}
