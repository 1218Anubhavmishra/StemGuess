import { useEffect, useState } from 'react';
import { bgMusic } from '../audio';
import SpeakerIcon from './SpeakerIcon';

export default function MusicToggle() {
  const [muted, setMuted] = useState(bgMusic.isMuted());
  // The starting screen has its own copy of this button.
  useEffect(() => bgMusic.subscribe(() => setMuted(bgMusic.isMuted())), []);
  return (
    <button
      className="mute ghost"
      aria-label={muted ? 'Turn music on' : 'Turn music off'}
      title={muted ? 'Music off' : 'Music on'}
      aria-pressed={!muted}
      onClick={() => {
        bgMusic.setMuted(!muted);
      }}
    >
      <SpeakerIcon muted={muted} />
    </button>
  );
}
