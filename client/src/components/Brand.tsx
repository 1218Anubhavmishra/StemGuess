/** The full app label, shown large only on the starting screen. */
export default function Brand() {
  return (
    <div className="brand-block">
      <header className="brand">
        <h1 className="logo">
          <img className="logo-icon" src="/logo-mark.svg" alt="" aria-hidden />
          <span className="logo-text">
            Stem<span>Guess</span>
          </span>
        </h1>
      </header>
    </div>
  );
}

/** The app label collapsed to its icon: the top left corner of every screen. */
export function BrandIcon() {
  return <img className="logo-icon topbar-icon" src="/logo-mark.svg" alt="StemGuess" />;
}
