import { useState } from 'react';
import { bgMusic } from '../audio';

export default function MusicToggle({ floating }: { floating?: boolean }) {
  const [muted, setMuted] = useState(bgMusic.isMuted());
  return (
    <button
      className={`mute ghost${floating ? ' floating' : ''}`}
      aria-label={muted ? 'Turn music on' : 'Turn music off'}
      title={muted ? 'Music off' : 'Music on'}
      aria-pressed={!muted}
      onClick={() => {
        bgMusic.setMuted(!muted);
        setMuted(!muted);
      }}
    >
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
        {muted ? (
          <path d="m16 9 5 6m0-6-5 6" />
        ) : (
          <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
        )}
      </svg>
    </button>
  );
}
