export default function Brand() {
  return (
    <div className="brand-block">
      <header className="brand">
        <h1 className="logo">
          <img className="logo-icon" src="/logo-mark.svg" alt="" aria-hidden />
          Stem<span>Guess</span>
        </h1>
      </header>
    </div>
  );
}

/** The app label collapsed to its icon, top left: every screen of a room (lobby, rounds, final scores). */
export function BrandIcon() {
  return <img className="logo-icon topbar-icon" src="/logo-mark.svg" alt="StemGuess" />;
}
