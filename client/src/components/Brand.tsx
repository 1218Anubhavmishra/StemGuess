import MusicToggle from './MusicToggle';

export default function Brand({ music = true }: { music?: boolean }) {
  return (
    <div className="brand-block">
      <header className="brand">
        <h1 className="logo">
          <img className="logo-icon" src="/logo-mark.svg" alt="" aria-hidden />
          Stem<span>Guess</span>
        </h1>
        {music && <MusicToggle />}
      </header>
      <p className="tagline">Guess the song from its first 15 seconds.</p>
    </div>
  );
}
