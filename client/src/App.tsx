import { useEffect, useState } from 'react';
import { bgMusic, stemPlayer } from './audio';
import { getClip } from './clipTransfer';
import { clearSession, loadSession, request, serverUrl, socket } from './socket';
import type { FeedItem, Phase, Player, RoomState, RoundAnswer } from './types';
import Home from './components/Home';
import Lobby from './components/Lobby';
import Game from './components/Game';
import GameOver from './components/GameOver';
let feedId = 0;

export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [phase, setPhase] = useState<Phase>('lobby');
  const [options, setOptions] = useState<string[]>([]);
  const [choice, setChoice] = useState<number | null>(null);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [nextAt, setNextAt] = useState<number | null>(null);
  const [answer, setAnswer] = useState<RoundAnswer | null>(null);
  const [ranking, setRanking] = useState<Player[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  // Host's own songs: how many players have received the clips, shown before the first round.
  const [transfer, setTransfer] = useState<{ ready: number; total: number } | null>(null);
  // Remounts the game view per game so in-game settings (volume, mute) start from their defaults.
  const [gameKey, setGameKey] = useState(0);

  useEffect(() => {
    const pushFeed = (item: Omit<FeedItem, 'id'>) =>
      setFeed((items) => [...items.slice(-49), { ...item, id: ++feedId }]);

    const exitRoom = () => {
      clearSession();
      setRoom(null);
      setPhase('lobby');
      stemPlayer.stop();
      stemPlayer.resetSettings();
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
    const onLocalOrder = () => {
      setPhase('prepare');
      setOptions([]);
      setAnswer(null);
    };
    const onLocalStatus = (p: { ready: number; total: number }) => setTransfer(p);
    const onPrepare = (p: { round: number; totalRounds: number; urls: string[]; resume?: boolean; track?: number }) => {
      setTransfer(null);
      setPhase('prepare');
      setOptions([]);
      setChoice(null);
      setAnswer(null);
      setEndsAt(null);
      setNextAt(null);
      if (p.resume) {
        setFeed([]);
      } else if (p.round === 1) {
        setFeed([]);
        setGameKey((k) => k + 1);
      }
      pushFeed({ type: 'system', text: `Round ${p.round} of ${p.totalRounds}` });
      if (p.track !== undefined) stemPlayer.prepareClip(getClip(p.track));
      else stemPlayer.prepare(p.urls.map(serverUrl));
    };
    const onStart = (p: { duration: number; options: string[]; choice?: number | null }) => {
      setPhase('playing');
      setOptions(p.options);
      setChoice(p.choice ?? null);
      setEndsAt(Date.now() + p.duration * 1000);
      void stemPlayer.start();
    };
    const onRoundEnd = (p: RoundAnswer & { options: string[]; winners: string[]; nextIn: number }) => {
      const song = p.artist ? `${p.title} - by ${p.artist}` : p.title;
      if (p.winners.length) p.winners.forEach((name) => pushFeed({ type: 'correct', name, text: song, points: p.points[name] }));
      else pushFeed({ type: 'nobody' });
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
      setNextAt(Date.now() + p.nextIn * 1000);
      stemPlayer.stop();
    };
    const onGameOver = (p: { ranking: Player[] }) => {
      setPhase('gameOver');
      setRanking(p.ranking);
      stemPlayer.stop();
      stemPlayer.resetSettings();
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room_state', onRoomState);
    socket.on('round_prepare', onPrepare);
    socket.on('round_start', onStart);
    socket.on('round_end', onRoundEnd);
    socket.on('game_over', onGameOver);
    socket.on('local_order', onLocalOrder);
    socket.on('local_status', onLocalStatus);
    if (socket.connected) void tryRejoin();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room_state', onRoomState);
      socket.off('round_prepare', onPrepare);
      socket.off('round_start', onStart);
      socket.off('round_end', onRoundEnd);
      socket.off('game_over', onGameOver);
      socket.off('local_order', onLocalOrder);
      socket.off('local_status', onLocalStatus);
    };
  }, []);

  const leave = async () => {
    stemPlayer.stop();
    stemPlayer.resetSettings();
    clearSession();
    await request('leave_room');
    setRoom(null);
    setPhase('lobby');
    setFeed([]);
  };

  const screen = !room
    ? 'home'
    : room.state === 'playing'
      ? 'game'
      : phase === 'gameOver'
        ? 'gameOver'
        : 'lobby';
  const menuMusic = screen === 'home' || screen === 'lobby';

  useEffect(() => bgMusic.setWanted(menuMusic), [menuMusic]);

  if (!room) {
    return (
      <Home connected={connected} />
    );
  }

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
          key={gameKey}
          room={room}
          meId={meId}
          phase={gameOver ? 'roundEnd' : phase}
          options={options}
          choice={choice}
          onPick={setChoice}
          endsAt={endsAt}
          nextAt={nextAt}
          answer={answer}
          feed={feed}
          transfer={transfer}
          onLeave={leave}
        />
      </div>
      {gameOver && <GameOver room={room} ranking={ranking} isHost={isHost} onLeave={leave} />}
    </>
  );
}
