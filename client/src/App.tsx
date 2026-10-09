import { useEffect, useState } from 'react';
import { bgMusic, stemPlayer } from './audio';
import { clearSession, loadSession, request, serverUrl, socket } from './socket';
import type { FeedItem, Phase, Player, RoomState, RoundAnswer, StemInfo } from './types';
import Home from './components/Home';
import Lobby from './components/Lobby';
import Game from './components/Game';
import GameOver from './components/GameOver';
let feedId = 0;

export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [phase, setPhase] = useState<Phase>('lobby');
  const [stems, setStems] = useState<StemInfo[]>([]);
  const [revealed, setRevealed] = useState(0);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [answer, setAnswer] = useState<RoundAnswer | null>(null);
  const [ranking, setRanking] = useState<Player[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
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
    const onPrepare = (p: { round: number; totalRounds: number; stems: StemInfo[]; resume?: boolean }) => {
      setPhase('prepare');
      setStems(p.stems);
      setRevealed(0);
      setAnswer(null);
      setEndsAt(null);
      if (p.resume) {
        setFeed([]);
      } else if (p.round === 1) {
        setFeed([]);
        setGameKey((k) => k + 1);
      }
      pushFeed({ type: 'system', text: `Round ${p.round} of ${p.totalRounds}` });
      stemPlayer.prepare(p.stems.map((s) => serverUrl(s.url)));
    };
    const onStart = (p: { duration: number }) => {
      setPhase('playing');
      setEndsAt(Date.now() + p.duration * 1000);
      void stemPlayer.start();
    };
    const onReveal = (p: { index: number }) => {
      setRevealed(p.index + 1);
      stemPlayer.reveal(p.index);
    };
    const onRoundEnd = (p: RoundAnswer & { stems: StemInfo[]; winners: string[] }) => {
      const song = p.artist ? `${p.title} - by ${p.artist}` : p.title;
      if (p.winners.length) p.winners.forEach((name) => pushFeed({ type: 'correct', name, text: song, points: p.points[name] }));
      else pushFeed({ type: 'nobody' });
      setPhase('roundEnd');
      setAnswer({ title: p.title, artist: p.artist, isLast: p.isLast, points: p.points });
      setEndsAt(null);
      setRevealed(p.stems.length);
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
    socket.on('stem_reveal', onReveal);
    socket.on('round_end', onRoundEnd);
    socket.on('game_over', onGameOver);
    socket.on('feed', pushFeed);
    if (socket.connected) void tryRejoin();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room_state', onRoomState);
      socket.off('round_prepare', onPrepare);
      socket.off('round_start', onStart);
      socket.off('stem_reveal', onReveal);
      socket.off('round_end', onRoundEnd);
      socket.off('game_over', onGameOver);
      socket.off('feed', pushFeed);
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
          stems={stems}
          revealed={revealed}
          endsAt={endsAt}
          answer={answer}
          feed={feed}
          isHost={isHost}
          onLeave={leave}
        />
      </div>
      {gameOver && <GameOver room={room} ranking={ranking} isHost={isHost} onLeave={leave} />}
    </>
  );
}
