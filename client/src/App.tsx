import { useEffect, useState, useSyncExternalStore } from 'react';
import { bgMusic, stemPlayer } from './audio';
import { clearSession, loadSession, request, serverUrl, socket } from './socket';
import type { GameSong, Phase, Player, RoomState, RoundAnswer } from './types';
import Home from './components/Home';
import Lobby from './components/Lobby';
import Game from './components/Game';
import GameOver from './components/GameOver';
const MUSIC_RETURN_MS = 1500;

export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [phase, setPhase] = useState<Phase>('lobby');
  const [options, setOptions] = useState<string[]>([]);
  const [choice, setChoice] = useState<number | null>(null);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [answer, setAnswer] = useState<RoundAnswer | null>(null);
  const [ranking, setRanking] = useState<Player[]>([]);
  const [songs, setSongs] = useState<GameSong[]>([]);
  // Which round this is. From the round's own message: a game can be shorter than the room's setting.
  const [roundCount, setRoundCount] = useState<{ round: number; total: number } | null>(null);

  useEffect(() => {
    const exitRoom = () => {
      clearSession();
      setRoom(null);
      setPhase('lobby');
      stemPlayer.stop();
    };
    const tryRejoin = async () => {
      const session = loadSession();
      if (!session) return;
      const ack = await request('rejoin', session);
      if (!ack.ok) exitRoom();
    };
    const onConnect = () => {
      setConnected(true);
      void tryRejoin();
    };
    // Keep the room on screen while socket.io reconnects; rejoin restores the seat or exits.
    const onDisconnect = () => {
      setConnected(false);
      stemPlayer.stop();
      if (!loadSession()) exitRoom();
    };
    const onRoomState = (state: RoomState) => setRoom(state);
    const onPrepare = (p: { round: number; totalRounds: number; urls: string[] }) => {
      setRoundCount({ round: p.round, total: p.totalRounds });
      setPhase('prepare');
      setOptions([]);
      setChoice(null);
      setAnswer(null);
      setEndsAt(null);
      stemPlayer.prepare(p.urls.map(serverUrl));
    };
    const onStart = (p: { duration: number; options: string[]; choice?: number | null }) => {
      setPhase('playing');
      setOptions(p.options);
      setChoice(p.choice ?? null);
      setEndsAt(Date.now() + p.duration * 1000);
      void stemPlayer.start();
    };
    const onRoundEnd = (p: RoundAnswer & { options: string[] }) => {
      setPhase('roundEnd');
      setOptions(p.options);
      setAnswer({
        title: p.title,
        artist: p.artist,
        credit: p.credit,
        correct: p.correct,
        isLast: p.isLast,
        points: p.points,
      });
      setEndsAt(null);
      stemPlayer.stop();
    };
    const onGameOver = (p: { ranking: Player[]; songs?: GameSong[] }) => {
      setPhase('gameOver');
      setRanking(p.ranking);
      setSongs(p.songs ?? []);
      stemPlayer.stop();
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room_state', onRoomState);
    socket.on('round_prepare', onPrepare);
    socket.on('round_start', onStart);
    socket.on('round_end', onRoundEnd);
    socket.on('game_over', onGameOver);
    socket.on('room_closed', exitRoom);
    if (socket.connected) void tryRejoin();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room_state', onRoomState);
      socket.off('round_prepare', onPrepare);
      socket.off('round_start', onStart);
      socket.off('round_end', onRoundEnd);
      socket.off('game_over', onGameOver);
      socket.off('room_closed', exitRoom);
    };
  }, []);

  const leave = async () => {
    stemPlayer.stop();
    clearSession();
    await request('leave_room');
    setRoom(null);
    setPhase('lobby');
  };

  const screen = !room
    ? 'home'
    : room.state === 'playing'
      ? 'game'
      : phase === 'gameOver'
        ? 'gameOver'
        : 'lobby';
  // The silent music keeps the notes drifting whenever a song isn't playing, except during a game.
  const songPlaying = useSyncExternalStore(stemPlayer.subscribe, stemPlayer.isPlaying);
  const musicAllowed = !songPlaying && screen !== 'game';

  useEffect(() => {
    if (!musicAllowed) return bgMusic.setWanted(false);
    // Waits a moment: changing song stops the old one before the next has loaded.
    const timer = setTimeout(() => bgMusic.setWanted(true), MUSIC_RETURN_MS);
    return () => clearTimeout(timer);
  }, [musicAllowed]);
  if (!room) return <Home connected={connected} />;

  const meId = socket.id ?? '';
  const isHost = room.hostId === meId;
  const banner = !connected && (
    <div className="reconnecting" role="status">
      Connection lost. Reconnecting…
    </div>
  );

  if (screen === 'lobby') {
    return (
      <>
        {banner}
        <Lobby room={room} isHost={isHost} onLeave={leave} />
      </>
    );
  }
  const gameOver = screen === 'gameOver';
  return (
    <>
      {banner}
      <div inert={gameOver}>
        <Game
          room={room}
          meId={meId}
          phase={gameOver ? 'roundEnd' : phase}
          options={options}
          choice={choice}
          onPick={setChoice}
          endsAt={endsAt}
          answer={answer}
          roundCount={roundCount}
          onLeave={leave}
        />
      </div>
      {gameOver && <GameOver room={room} ranking={ranking} songs={songs} isHost={isHost} onLeave={leave} />}
    </>
  );
}
