import MusicToggle from './MusicToggle';

export default function Brand({ music = true }: { music?: boolean }) {
  return (
    <div className="brand-block">
      <header className="brand">
        <h1 className="logo">
          Stem<span>Guess</span>
        </h1>
        {music && <MusicToggle />}
      </header>
      <p className="tagline">Guess Songs with their instruments.</p>
    </div>
  );
}
