import { useState } from 'react';
import { bgMusic } from '../audio';

export default function MusicToggle() {
  const [muted, setMuted] = useState(bgMusic.isMuted());
  return (
    <button
      className="mute ghost"
      aria-pressed={!muted}
      onClick={() => {
        bgMusic.setMuted(!muted);
        setMuted(!muted);
      }}
    >
      Music: {muted ? 'off' : 'on'}
    </button>
  );
}
