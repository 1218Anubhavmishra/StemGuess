import { useLayoutEffect, useRef, useState } from 'react';
import { titleCase } from '../names';
import type { RoomState } from '../types';

/** Room between the seat columns, in pixels. */
const COLUMN_GAP = 28;

/**
 * As many columns as the seats fit in side by side, each as wide as its widest seat (filled row by row). From each
 * seat's natural width and the room there is; one column at the least.
 */
function fitColumns(widths: number[], room: number): number {
  for (let columns = widths.length; columns > 1; columns--) {
    const columnWidths = Array.from({ length: columns }, (_, c) =>
      Math.max(...widths.filter((_, i) => i % columns === c)),
    );
    if (columnWidths.reduce((a, b) => a + b, 0) + COLUMN_GAP * (columns - 1) <= room) return columns;
  }
  return 1;
}

/**
 * The lobby's numbered seats: one per allowed player, empty until someone joins or while they're offline. Laid out as a
 * table without inner lines, whose number of columns and their widths follow the names and the screen.
 */
export function PlayerSlots({ room, meId }: { room: RoomState; meId: string }) {
  const seats = Math.max(room.maxPlayers, room.players.length);
  const list = useRef<HTMLOListElement>(null);
  const measure = useRef<HTMLOListElement>(null);
  const [columns, setColumns] = useState(1);

  const rows = Array.from({ length: seats }, (_, i) => {
    const p = room.players[i];
    if (!p?.connected) return { key: `empty-${i}`, className: 'empty', content: null };
    return {
      key: p.id,
      className: p.id === meId ? 'me' : '',
      content: (
        <>
          {/* The name is cut short when it must be, never the host tag after it. */}
          <span className="player-name">{titleCase(p.name)}</span>
          {p.id === room.hostId && <span className="tag">host</span>}
        </>
      ),
    };
  });
  const names = rows.map((r) => r.key).join('|');

  useLayoutEffect(() => {
    const el = list.current;
    const ruler = measure.current;
    if (!el || !ruler) return;
    const fit = () => {
      const widths = [...ruler.children].map((li) => Math.ceil(li.getBoundingClientRect().width));
      setColumns(fitColumns(widths, el.clientWidth));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [names]);

  return (
    <div className="player-slots-wrap">
      <ol
        ref={list}
        className="player-slots"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, max-content))`, columnGap: COLUMN_GAP }}
      >
        {rows.map((r) => (
          <li key={r.key} className={r.className} aria-label={r.content ? undefined : 'Empty'}>
            {r.content}
          </li>
        ))}
      </ol>
      {/* The same seats at their natural widths, out of sight, to measure. */}
      <ol ref={measure} className="player-slots player-slots-measure" aria-hidden>
        {rows.map((r) => (
          <li key={r.key} className={r.className}>
            {r.content}
          </li>
        ))}
      </ol>
    </div>
  );
}
