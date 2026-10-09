import { useEffect, useState } from 'react';
import { request, socket } from '../socket';
import { SONG_LIMITS, type RoomState } from '../types';
import Brand from './Brand';
import Scoreboard from './Scoreboard';
import Stepper from './Stepper';

export default function Lobby({ room, isHost, onLeave }: { room: RoomState; isHost: boolean; onLeave: () => void }) {
  const [error, setError] = useState('');
  const [librarySize, setLibrarySize] = useState<number | null>(null);

  useEffect(() => {
    void request('library').then((ack) => ack.ok && setLibrarySize(ack.songs ?? 0));
  }, []);

  const maxSongs = Math.min(SONG_LIMITS.max, librarySize ?? SONG_LIMITS.max);
  const notEnoughSongs = librarySize !== null && librarySize < SONG_LIMITS.min;

  async function update(settings: { rounds?: number }) {
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

          <h3 className="players-head">
            Players in the room : {room.players.length}/{room.maxPlayers}
          </h3>
          <Scoreboard room={room} meId={socket.id ?? ''} />

          {isHost ? (
            <>
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
                  The library has {librarySize} song{librarySize === 1 ? '' : 's'}. Add at least {SONG_LIMITS.min} to play.
                </p>
              )}
            </>
          ) : (
            <>
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
