import { useEffect } from 'react';
import { GITHUB_URL, PLAYER_LIMITS, SONG_LIMITS } from '../types';
import Brand from './Brand';
import { ScrollArrows, useScrollHints } from './ScrollHints';
import SectionNav, { type Section } from './SectionNav';

export default function About({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate: (section: Section) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // No scrollbar: grey lines (with arrows) above or below the text show there's more to scroll to.
  const scroll = useScrollHints<HTMLDivElement>();

  return (
    <div className="overlay about-page" onClick={onClose}>
      <div className="about-stack" onClick={(e) => e.stopPropagation()}>
        <Brand />
        <section className="card about" role="dialog" aria-modal="true" aria-labelledby="about-title">
          <header className="about-head">
            <h2 id="about-title">About StemGuess</h2>
          </header>
          {/* Only the text scrolls; the title and the credit stay in place. */}
          <div className={`about-scroll ${scroll.wrapClassName}`}>
            <div ref={scroll.ref} className={`about-body ${scroll.className}`} onScroll={scroll.onScroll}>
              <p>
                StemGuess is a multiplayer "name that song" game. Each round plays the first 15 seconds of a song, and
                everyone races to pick the right title.
              </p>

              <h3>Play with friends</h3>
              <ol>
                <li>
                  Enter your name, choose the max players ({PLAYER_LIMITS.min}–{PLAYER_LIMITS.max}) and press Create
                  Room.
                </li>
                <li>Share the 4-letter room code or copy the invite link. Friends join with the code.</li>
                <li>
                  As the host, choose how many songs to play ({SONG_LIMITS.min}–{SONG_LIMITS.max}). Use Filters to play
                  only some genres, languages or artists (see Song filters below). Then press Start game. The game also
                  starts by itself once the room is full.
                </li>
              </ol>

              <h3>How a round works</h3>
              <ul>
                <li>The clip loops until the timer runs out. Pick one of the four titles; you only get one pick.</li>
                <li>Faster right answers score more: 10 points at the start, falling to 1 point at the buzzer.</li>
                <li>
                  Stuck? From halfway through the round you can remove a wrong option, and then one more. Only you see
                  them disappear. A right answer then scores ×0.5 its points after one removal, or ×0.2 after two.
                </li>
                <li>
                  After each round you see the answer and its credit. The highest score after the last song wins, and
                  the final scores list every song of the game with a button to replay it.
                </li>
                <li>Use the speaker button and slider to mute or change the game volume. End leaves the game.</li>
                <li>If your connection drops, the game keeps your seat and puts you back in when you reconnect.</li>
                <li>
                  Joining a game that has already started (for example after losing your seat) lets you spectate: you
                  see and hear every round but can't answer, and you join as a player when the game ends. A room holds
                  at most 10 people, players and spectators together.
                </li>
              </ul>

              <h3>Songs</h3>
              <p>
                <b>Preview of hits</b>: the first 15 seconds of popular hits, vocals and all, linking to their official
                YouTube video, or to Apple Music when no YouTube upload is available.
              </p>
              <p className="muted small">
                The game picks the songs at random, so nobody (not even the host) knows what's coming.
              </p>

              <h3>Song filters</h3>
              <p>
                Song filters are available both in the game (the host sets them in the room) and in Play Library and
                Practice. Choose genres, languages or artists: options picked in one list widen the pick (Pop or Rock),
                options in different lists narrow it (Pop or Rock, and in Hindi). Each option shows how many songs it
                would match, and the Filters button shows how many songs are available. A song with several genres,
                languages or artists counts under each of them; Hindi, Punjabi and Haryanvi songs are also Indian.
              </p>

              <h3>Play Library and Practice</h3>
              <p>
                Play Library lists every song in the game. Pick one to play it, then pause, jump 5 seconds back or
                forward, go to the previous or next song, or drag the progress bar to any point; the next song starts
                when one ends. Practice plays random songs for you to guess on your own and counts how many you get
                right. No room needed. In both, Filters narrows the songs by genre, language or artist.
              </p>
              <p>
                The Practice, Play Library, Game room and About buttons at the bottom of every section take you straight
                to each of them.
              </p>

              <h3>Other options</h3>
              <ul>
                <li>The speaker next to the logo turns the menu music on or off.</li>
                <li>Your name is remembered on this device for next time.</li>
              </ul>
            </div>
            <ScrollArrows more={scroll.more} scrollBy={scroll.scrollBy} />
          </div>

          <p className="about-github">
            Made by{' '}
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              1218Anubhavmishra on GitHub
            </a>
          </p>
        </section>
        <SectionNav current="about" onGo={onNavigate} />
      </div>
    </div>
  );
}
