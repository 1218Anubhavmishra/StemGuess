import { useEffect } from 'react';
import { GITHUB_URL, PLAYER_LIMITS, SONG_LIMITS } from '../types';

export default function About({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <section
        className="card about"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="about-head">
          <h2 id="about-title">About StemGuess</h2>
          <button className="back-button" aria-label="Back" title="Back" onClick={onClose}>
            &lt;
          </button>
        </header>

        <p>
          StemGuess is a multiplayer "name that song" game. Each round plays a short clip of a song, built from its
          instrument stems, and everyone races to pick the right title.
        </p>

        <h3>Play with friends</h3>
        <ol>
          <li>Enter your name, choose the max players ({PLAYER_LIMITS.min}–{PLAYER_LIMITS.max}) and press Create Room.</li>
          <li>Share the 4-letter room code, the invite link or the QR code. Friends join with the code.</li>
          <li>
            As the host, pick where the songs come from and how many songs to play ({SONG_LIMITS.min}–{SONG_LIMITS.max}),
            then press Start game. The game also starts by itself once the room is full.
          </li>
        </ol>

        <h3>How a round works</h3>
        <ul>
          <li>The clip loops until the timer runs out. Pick one of the four titles; you only get one pick.</li>
          <li>Faster right answers score more: 10 points at the start, falling to 1 point at the buzzer.</li>
          <li>After each round you see the answer and its credit. The highest score after the last song wins.</li>
          <li>Use the speaker button and slider to mute or change the game volume. End leaves the game.</li>
          <li>If your connection drops, the game keeps your seat and puts you back in when you reconnect.</li>
          <li>
            Joining a game that has already started (for example after losing your seat) lets you spectate: you
            see and hear every round but can't answer, and you join as a player when the game ends. A room holds at
            most 10 people, players and spectators together.
          </li>
          <li>With My music, everyone's clips are kept on their device for the game, so reloading the page doesn't lose them.</li>
        </ul>

        <h3>Song sources</h3>
        <ul>
          <li>
            <b>StemGuess demos</b>: original tracks made by StemGuess, one for each music genre.
          </li>
          <li>
            <b>Creative Commons</b>: songs their artists share under Creative Commons licences, credited after each
            round.
          </li>
          <li>
            <b>Preview of hits</b>: short previews of popular hits with the vocals taken out, linking to their
            YouTube video where there is one.
          </li>
          <li>
            <b>My music</b>: the host picks a folder of songs on their device. Their browser cuts a clip of each and
            cancels the vocals mixed in the centre (some backing vocals and effects can remain; mono files keep
            theirs). The clips go straight to the other players and are never stored by StemGuess.
          </li>
        </ul>
        <p className="muted small">
          In every mode the game picks the songs at random, so nobody (not even the host) knows what's coming. The
          host can also choose artists, so only their songs come up (songs featuring them count too).
        </p>

        <h3>Song Library and Practice</h3>
        <p>
          Song Library lists every song in any of the four song sources. Pick one to play it, then pause, jump 5 seconds
          back or forward, go to the previous or next song, or drag the progress bar to any point; the next song
          starts when one ends. Practice (also its
          own button) plays random songs for you to guess on your own and counts how many you get right. No room
          needed. In both, Artists narrows the songs to the artists you pick.
        </p>

        <h3>Other options</h3>
        <ul>
          <li>The speaker next to the logo turns the menu music on or off.</li>
          <li>Your name is remembered on this device for next time.</li>
        </ul>

        <p className="about-github">
          Made by{' '}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            1218Anubhavmishra on GitHub
          </a>
        </p>
      </section>
    </div>
  );
}
