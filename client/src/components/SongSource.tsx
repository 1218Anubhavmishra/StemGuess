import type { RoomState, ServerLibrary } from '../types';

/** How many songs the room's game can draw from (when no Filters button shows the count). */
export default function SongSource({
  room,
  libraries,
  rounds,
  showCount,
}: {
  room: RoomState;
  libraries: Record<ServerLibrary, number> | null;
  rounds: number;
  /** Say how many songs were found (when no Filters button shows the count). */
  showCount: boolean;
}) {
  if (!libraries || !showCount) return null;
  return (
    <p className="muted small" role="status">
      Found {room.poolSize ?? libraries[room.library]} songs. The game will pick {rounds} at random.
    </p>
  );
}
