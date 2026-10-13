import type { LibraryMode } from './SongLibrary';

export default function MenuLinks({ onLibrary, onAbout }: { onLibrary: (mode: LibraryMode) => void; onAbout: () => void }) {
  return (
    <nav className="menu-links" aria-label="More">
      <button onClick={() => onLibrary('songs')}>Song Library</button>
      <button onClick={() => onLibrary('practice')}>Practice</button>
      <button onClick={onAbout}>About</button>
    </nav>
  );
}
