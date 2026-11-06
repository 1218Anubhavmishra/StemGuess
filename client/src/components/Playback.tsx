import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { stemPlayer } from '../audio';

type State = { position: number; duration: number; playing: boolean };

/** The stem player's position, refreshed every animation frame. */
export function usePlayback(): State {
  const [state, setState] = useState<State>({ position: 0, duration: 0, playing: false });
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const next = { position: stemPlayer.position(), duration: stemPlayer.duration(), playing: stemPlayer.isPlaying() };
      setState((prev) =>
        Math.abs(prev.position - next.position) < 0.05 && prev.duration === next.duration && prev.playing === next.playing
          ? prev
          : next,
      );
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return state;
}

export function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** How far into the song playback is; dragging or clicking it jumps there. */
export function ProgressBar() {
  const { position, duration } = usePlayback();
  const percent = duration ? (position / duration) * 100 : 0;
  // While the next song loads, the last length stays up instead of flashing 0:00.
  const lastDuration = useRef(0);
  if (duration) lastDuration.current = duration;
  return (
    <div className="progress-row">
      <span className="progress-time">{formatTime(position)}</span>
      <input
        className="progress seek"
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={Math.min(position, duration)}
        disabled={!duration}
        aria-label="Seek"
        style={{ '--fill': `${percent}%` } as CSSProperties}
        onChange={(e) => stemPlayer.seek(Number(e.target.value))}
      />
      <span className="progress-time">{formatTime(lastDuration.current)}</span>
    </div>
  );
}
