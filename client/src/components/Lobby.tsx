import { useEffect, useState } from 'react';
import { request, socket } from '../socket';
import { LOCAL_POOL_FACTOR, SONG_LIMITS, type Library, type RoomState } from '../types';
import Brand from './Brand';
import Invite from './Invite';
import Scoreboard from './Scoreboard';
import SongSource, { GUEST_NOTICES, LIBRARY_LABELS } from './SongSource';
import Stepper from './Stepper';

export default function Lobby({ room, isHost, onLeave }: { room: RoomState; isHost: boolean; onLeave: () => void }) {
  const [error, setError] = useState('');
  const [libraries, setLibraries] = useState<Record<'demo' | 'cc', number> | null>(null);

  useEffect(() => {
    void request('library').then((ack) => ack.ok && setLibraries(ack.libraries ?? null));
  }, []);

  const local = room.library === 'local';
  // Songs per game the library can supply (the host's own songs are drawn from a bigger pool).
  const librarySize = local
    ? Math.floor(room.localTracks / LOCAL_POOL_FACTOR)
    : (libraries?.[room.library as 'demo' | 'cc'] ?? null);
  const maxSongs = Math.min(SONG_LIMITS.max, librarySize ?? SONG_LIMITS.max);
  const notEnoughSongs = local
    ? room.localTracks < room.totalRounds * LOCAL_POOL_FACTOR
    : librarySize !== null && librarySize < SONG_LIMITS.min;

  async function update(settings: { rounds?: number; library?: Library }) {
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
      <div className="home-stack">
        <Brand />

        <div className="card narrow">
          <div className="room-code-row">
            <span className="muted small">Room code</span>
            <h1 className="room-code">{room.code}</h1>
            <span className="muted small">Share this code with your friends.</span>
          </div>
          <Invite code={room.code} />

          <h3 className="players-head">
            Players in the room : {room.players.length}/{room.maxPlayers}
          </h3>
          <Scoreboard room={room} meId={socket.id ?? ''} />

          {isHost ? (
            <>
              <SongSource
                room={room}
                libraries={libraries}
                minSongs={SONG_LIMITS.min}
                rounds={room.totalRounds}
                onChange={(library) => void update({ library })}
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
              {notEnoughSongs && !local && (
                <p className="muted small">
                  This library has {librarySize} song{librarySize === 1 ? '' : 's'}. It needs at least {SONG_LIMITS.min} to play.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="source-chip">{LIBRARY_LABELS[room.library]}</p>
              <p className="notice small">{GUEST_NOTICES[room.library]}</p>
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
        </div>
      </div>
    </main>
  );
}
