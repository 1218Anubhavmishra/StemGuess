/** The app's sections besides the home screen. 'room' is the game room: the lobby, or Create / Join without one. */
export type Section = 'songs' | 'practice' | 'room' | 'about';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'practice', label: 'Practice' },
  { id: 'songs', label: 'Play Library' },
  { id: 'room', label: 'Game room' },
  { id: 'about', label: 'About' },
];

/** Buttons under a section's window for going straight to the other sections. The current one is marked. */
export default function SectionNav({ current, onGo }: { current?: Section; onGo: (section: Section) => void }) {
  return (
    <nav className="menu-links section-nav" aria-label="Sections">
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          className={s.id === current ? 'on' : undefined}
          aria-current={s.id === current ? 'page' : undefined}
          disabled={s.id === current}
          onClick={() => onGo(s.id)}
        >
          {s.label}
        </button>
      ))}
    </nav>
  );
}
