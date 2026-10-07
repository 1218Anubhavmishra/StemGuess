import { useEffect, useState } from 'react';
import { request, socket } from '../socket';
import { PLAYER_LIMITS, SONG_LIMITS, type RoomState } from '../types';
import Scoreboard from './Scoreboard';

type StepperProps = { label: string; value: number; min: number; max: number; onChange: (v: number) => void };

function Stepper({ label, value, min, max, onChange }: StepperProps) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="stepper">
        <button aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
        <output>{value}</output>
        <button aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

export default function Lobby({ room, isHost, onLeave }: { room: RoomState; isHost: boolean; onLeave: () => void }) {
  const [error, setError] = useState('');
  const [librarySize, setLibrarySize] = useState<number | null>(null);

  useEffect(() => {
    void request('library').then((ack) => ack.ok && setLibrarySize(ack.songs ?? 0));
  }, []);

  const maxSongs = Math.min(SONG_LIMITS.max, librarySize ?? SONG_LIMITS.max);
  const notEnoughSongs = librarySize !== null && librarySize < SONG_LIMITS.min;

  async function update(settings: { rounds?: number; maxPlayers?: number }) {
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
      <div className="card narrow">
        <p className="muted small">Room code</p>
        <h1 className="room-code">{room.code}</h1>
        <p className="muted small">Share this code with your friends.</p>

        <h3>
          Players ({room.players.length}/{room.maxPlayers})
        </h3>
        <Scoreboard room={room} meId={socket.id ?? ''} />

        {isHost ? (
          <>
            <div className="settings">
              <Stepper
                label="Songs"
                value={room.totalRounds}
                min={SONG_LIMITS.min}
                max={Math.max(SONG_LIMITS.min, maxSongs)}
                onChange={(rounds) => void update({ rounds })}
              />
              <Stepper
                label="Max players"
                value={room.maxPlayers}
                min={Math.max(PLAYER_LIMITS.min, room.players.length)}
                max={PLAYER_LIMITS.max}
                onChange={(maxPlayers) => void update({ maxPlayers })}
              />
            </div>
            {notEnoughSongs && (
              <p className="muted small">
                The library has {librarySize} song{librarySize === 1 ? '' : 's'}. Add at least {SONG_LIMITS.min} to play.
              </p>
            )}
            <button className="primary" disabled={notEnoughSongs} onClick={() => void start()}>
              Start
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              {room.totalRounds} songs · up to {room.maxPlayers} players
            </p>
            <p className="muted">Waiting for the host to start…</p>
          </>
        )}

        {error && <p className="error">{error}</p>}
        <button className="ghost" onClick={onLeave}>
          Leave room
        </button>
      </div>
    </main>
  );
}
