import type { RoomState } from '../types';

/** Player list. Scores stay hidden until the final results; during a round it marks who guessed. */
type Props = { room: RoomState; meId: string; showGuessed?: boolean; plain?: boolean };

export default function Scoreboard({ room, meId, showGuessed, plain }: Props) {
  return (
    <ul className={plain ? 'scoreboard plain' : 'scoreboard'}>
      {room.players.map((p) => (
        <li key={p.id} className={[p.id === meId && 'me', showGuessed && p.guessed && 'guessed'].filter(Boolean).join(' ')}>
          <span className="name">
            {p.name}
            {p.id === room.hostId && <span className="tag">host</span>}
          </span>
          {showGuessed && p.guessed && <span className="got-it">Got it</span>}
          {showGuessed && p.attempted && !p.guessed && <span className="tag">guessed</span>}
        </li>
      ))}
    </ul>
  );
}
