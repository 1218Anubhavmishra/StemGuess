import { useEffect, useState } from 'react';
import { request, socket } from '../socket';
import { SONG_LIMITS, type RoomState, type ServerLibrary } from '../types';
import { FILTER_KINDS, FILTER_LABELS, hasFilters, type SongFilters } from '../filters';
import Brand from './Brand';
import Cover from './Cover';
import Invite from './Invite';
import { PlayerSlots } from './PlayerSlots';
import { ScrollArrows, WindowBody, useScrollHints } from './ScrollHints';

export default function Lobby({
  room,
  isHost,
  onLeave,
}: {
  room: RoomState;
  isHost: boolean;
  onLeave: () => void;
}) {
  const [error, setError] = useState('');
  const songRow = useScrollHints<HTMLOListElement>('x');
  const [libraries, setLibraries] = useState<Record<ServerLibrary, number> | null>(null);

  useEffect(() => {
    void request('library').then((ack) => ack.ok && setLibraries(ack.libraries ?? null));
  }, []);

  // The song filters are chosen on the Room Settings screen, before the room; here everyone sees them.
  const filters: SongFilters = { genres: room.genres, languages: room.languages, artists: room.artists };
  // Songs (matching the filters) the game can draw from.
  const librarySize = room.poolSize ?? libraries?.[room.library] ?? null;
  const notEnoughSongs = librarySize !== null && librarySize < SONG_LIMITS.min;
  const chosen = (
    <>
      {FILTER_KINDS.map(
        (kind) =>
          filters[kind].length > 0 && (
            <p key={kind} className="muted">
              {FILTER_LABELS[kind]}: {filters[kind].join(', ')}
            </p>
          ),
      )}
      {room.search && <p className="muted">Search: "{room.search}"</p>}
      {room.songs.length > 0 && (
        <section className="game-songs" aria-label="Songs in this game">
          <p className="game-songs-head">
            {/* The rounds secretly play this many of the listed options. */}
            Game Songs : {Math.min(room.totalRounds, room.songs.length)}
            <span className="muted small"> from {room.songs.length} options</span>
          </p>
          {/* A sideways row of song cards, like the final scores' (without replay). */}
          <div className={`${songRow.wrapClassName} quiet`}>
            <ol ref={songRow.ref} className={`song-cards ${songRow.className}`} onScroll={songRow.onScroll}>
              {room.songs.map((song, i) => (
                <li key={`${i}:${song.title}`} className="song-card">
                  <span className="song-card-cover">
                    <Cover credit={song.credit ?? null} lazy />
                    <span className="song-card-place">{i + 1}</span>
                  </span>
                  <b className="song-card-title">{song.title}</b>
                  {song.artist && <span className="song-card-artist muted">{song.artist}</span>}
                </li>
              ))}
            </ol>
            <ScrollArrows more={songRow.more} scrollBy={songRow.scrollBy} axis="x" />
          </div>
        </section>
      )}
    </>
  );

  async function start() {
    setError('');
    const ack = await request('start_game');
    if (!ack.ok) setError(ack.error ?? 'Could not start');
  }

  return (
    <main className="screen center">
      <div className="home-stack">
        <Brand />

        <div className="card narrow">
          <WindowBody>
            <Invite code={room.code} />

            {chosen}

            <div className="players-box">
              <PlayerSlots room={room} meId={socket.id ?? ''} />
            </div>

            {isHost ? (
              <>
                <button className="primary" disabled={notEnoughSongs} onClick={() => void start()}>
                  Start game
                </button>
                {notEnoughSongs && (
                  <p className="muted small">
                    {hasFilters(filters) || room.search ? 'The chosen filters match' : 'This library has'}{' '}
                    {librarySize} song{librarySize === 1 ? '' : 's'}. A game needs at least {SONG_LIMITS.min}.
                  </p>
                )}
              </>
            ) : (
              <p className="muted">Waiting for the host to start…</p>
            )}

            {error && <p className="error">{error}</p>}
            <button className="ghost leave-room" onClick={onLeave}>
              <span className="arrow" aria-hidden>
                ←
              </span>
              Leave room
            </button>
          </WindowBody>
        </div>
      </div>
    </main>
  );
}
