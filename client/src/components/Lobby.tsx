import { useEffect, useState, type ReactNode } from 'react';
import { request, socket } from '../socket';
import { SONG_LIMITS, type RoomState, type ServerLibrary } from '../types';
import { FILTER_KINDS, FILTER_LABELS, hasFilters, tidySearch, type SongFilters } from '../filters';
import { BrandIcon } from './Brand';
import Filters, { SEARCH_DELAY_MS, showsFilters, useLibraryFacets } from './Filters';
import Invite from './Invite';
import { PlayerSlots, Spectators } from './Scoreboard';
import { WindowBody } from './ScrollHints';
import SongSource from './SongSource';
import Stepper from './Stepper';

export default function Lobby({
  room,
  isHost,
  onLeave,
  menu,
}: {
  room: RoomState;
  isHost: boolean;
  onLeave: () => void;
  menu: ReactNode;
}) {
  const [error, setError] = useState('');
  const [libraries, setLibraries] = useState<Record<ServerLibrary, number> | null>(null);

  useEffect(() => {
    void request('library').then((ack) => ack.ok && setLibraries(ack.libraries ?? null));
  }, []);

  // What the host is typing, per library (changing library clears the room's search).
  const [typed, setTyped] = useState({ library: room.library, text: room.search });
  const search = typed.library === room.library ? typed.text : room.search;
  const facets = useLibraryFacets(room.library, true, isHost ? search : '');
  const filters: SongFilters = { genres: room.genres, languages: room.languages, artists: room.artists };

  useEffect(() => {
    if (!isHost || tidySearch(search) === room.search) return;
    const timer = setTimeout(() => {
      void request('update_settings', { search }).then((ack) => {
        if (!ack.ok) setError(ack.error ?? 'Could not update settings');
      });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isHost, search, room.search]);
  // Songs (matching the filters) the game can draw from.
  const librarySize = room.poolSize ?? libraries?.[room.library] ?? null;
  const maxSongs = Math.min(SONG_LIMITS.max, librarySize ?? SONG_LIMITS.max);
  const notEnoughSongs = librarySize !== null && librarySize < SONG_LIMITS.min;

  async function update(settings: { rounds?: number } & Partial<SongFilters>) {
    setError('');
    const ack = await request('update_settings', settings);
    if (!ack.ok) setError(ack.error ?? 'Could not update settings');
  }

  async function start() {
    setError('');
    const ack = await request('start_game');
    if (!ack.ok) setError(ack.error ?? 'Could not start');
  }

  return (
    <main className="screen center">
      <header className="topbar">
        <BrandIcon />
      </header>
      <div className="home-stack">

        <div className="card narrow">
          <WindowBody>
            <Invite code={room.code} />

            <div className="players-box">
              <PlayerSlots room={room} meId={socket.id ?? ''} />
            </div>
            <Spectators room={room} meId={socket.id ?? ''} className="players-box" />

            {isHost ? (
              <>
                <SongSource
                  room={room}
                  libraries={libraries}
                  rounds={room.totalRounds}
                  showCount={showsFilters(facets, filters, search) === false}
                />
                <Filters
                  facets={facets}
                  value={filters}
                  onChange={(next) => void update(next)}
                  search={{ value: search, onChange: (text) => setTyped({ library: room.library, text }) }}
                />
                <div className="row create-row">
                  <Stepper
                    label="Songs"
                    inline
                    value={room.totalRounds}
                    min={SONG_LIMITS.min}
                    max={Math.max(SONG_LIMITS.min, maxSongs)}
                    onChange={(rounds) => void update({ rounds })}
                  />
                  <button className="primary" disabled={notEnoughSongs} onClick={() => void start()}>
                    Start game
                  </button>
                </div>
                {notEnoughSongs && (
                  <p className="muted small">
                    {hasFilters(filters) || room.search ? 'The chosen filters match' : 'This library has'}{' '}
                    {librarySize} song{librarySize === 1 ? '' : 's'}. A game needs at least {SONG_LIMITS.min}.
                  </p>
                )}
              </>
            ) : (
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
                <p className="muted">{room.totalRounds} songs</p>
                <p className="muted">Waiting for the host to start…</p>
              </>
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
        {menu}
      </div>
    </main>
  );
}
