export default function MenuLinks({ onPractice, onAbout }: { onPractice: () => void; onAbout: () => void }) {
  return (
    <nav className="menu-links" aria-label="More">
      <button onClick={onPractice}>Play Library</button>
      <button onClick={onAbout}>About</button>
    </nav>
  );
}
