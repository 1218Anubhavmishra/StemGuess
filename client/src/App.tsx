import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { bgMusic, stemPlayer } from './audio';
import { clearSession, loadSession, request, serverUrl, socket } from './socket';
import type { FeedItem, GameSong, Phase, Player, RoomState, RoundAnswer } from './types';
import Home from './components/Home';
import Lobby from './components/Lobby';
import Game from './components/Game';
import GameOver from './components/GameOver';
import About from './components/About';
import SectionNav, { type Section } from './components/SectionNav';
import SongLibrary, { type LibraryMode } from './components/SongLibrary';
let feedId = 0;
const MUSIC_RETURN_MS = 1500;
// Changing section: the old one fades out for this long, then the new one floats in (see styles.css).
const SECTION_OUT_MS = 320;
const SECTION_IN_MS = 950;

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
  const [songs, setSongs] = useState<GameSong[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [libraryMode, setLibraryMode] = useState<LibraryMode | null>(null);
  const [about, setAbout] = useState(false);

  useEffect(() => {
    const pushFeed = (item: Omit<FeedItem, 'id'>) => setFeed((items) => [...items, { ...item, id: ++feedId }]);

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
    const onPrepare = (p: { round: number; totalRounds: number; urls: string[]; resume?: boolean }) => {
      setPhase('prepare');
      setOptions([]);
      setChoice(null);
      setAnswer(null);
      setEndsAt(null);
      setNextAt(null);
      if (p.resume || p.round === 1) setFeed([]);
      pushFeed({ type: 'system', text: `Round ${p.round} of ${p.totalRounds}` });
      stemPlayer.prepare(p.urls.map(serverUrl));
    };
    const onStart = (p: { duration: number; options: string[]; choice?: number | null }) => {
      setPhase('playing');
      setOptions(p.options);
      setChoice(p.choice ?? null);
      setEndsAt(Date.now() + p.duration * 1000);
      void stemPlayer.start();
    };
    const onRoundEnd = (p: RoundAnswer & { options: string[]; winners: string[]; nextIn: number }) => {
      if (p.winners.length) p.winners.forEach((name) => pushFeed({ type: 'correct', name }));
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
    setFeed([]);
  };

  const screen = !room
    ? 'home'
    : room.state === 'playing'
      ? 'game'
      : phase === 'gameOver'
        ? 'gameOver'
        : 'lobby';
  const practising = libraryMode !== null && (screen === 'home' || screen === 'lobby');
  // The music fills every moment a song isn't playing, except during a game: there it would sound like a clue.
  const songPlaying = useSyncExternalStore(stemPlayer.subscribe, stemPlayer.isPlaying);
  const musicAllowed = !songPlaying && screen !== 'game';

  useEffect(() => {
    if (!musicAllowed) return bgMusic.setWanted(false);
    // Waits a moment: changing song stops the old one before the next has loaded.
    const timer = setTimeout(() => bgMusic.setWanted(true), MUSIC_RETURN_MS);
    return () => clearTimeout(timer);
  }, [musicAllowed]);
  // A game starting (e.g. the room filled up) takes over from the Song Library.
  useEffect(() => {
    if (screen === 'game') setLibraryMode(null);
  }, [screen]);

  const sectionTimers = useRef<number[]>([]);
  useEffect(
    () => () => {
      sectionTimers.current.forEach(clearTimeout);
      document.body.classList.remove('section-leaving', 'entering');
    },
    [],
  );

  /** Makes the change once the current section has faded out; the new one then floats in. */
  const changeSection = (change: () => void) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return change();
    const { classList } = document.body;
    sectionTimers.current.forEach(clearTimeout);
    classList.remove('entering');
    classList.add('section-leaving');
    sectionTimers.current = [
      window.setTimeout(() => {
        change();
        classList.remove('section-leaving');
        classList.add('entering');
        sectionTimers.current = [window.setTimeout(() => classList.remove('entering'), SECTION_IN_MS)];
      }, SECTION_OUT_MS),
    ];
  };

  const navigate = (section: Section) => {
    if (section === 'about') {
      // Opens over the current section, so Back returns to it.
      changeSection(() => setAbout(true));
      return;
    }
    stemPlayer.stop();
    changeSection(() => {
      setAbout(false);
      setLibraryMode(section === 'room' ? null : section);
    });
  };
  // The section buttons under the home screen and the room lobby (both are the game room).
  const menu = <SectionNav current="room" onGo={navigate} />;
  const aboutDialog = about && <About onClose={() => changeSection(() => setAbout(false))} onNavigate={navigate} />;

  if (libraryMode && practising) {
    return (
      <>
        <SongLibrary
          key={libraryMode}
          connected={connected}
          mode={libraryMode}
          onNavigate={navigate}
        />
        {aboutDialog}
      </>
    );
  }

  if (!room) {
    return (
      <>
        <Home connected={connected} menu={menu} />
        {aboutDialog}
      </>
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
        <Lobby room={room} isHost={isHost} onLeave={leave} menu={menu} />
        {aboutDialog}
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
          nextAt={nextAt}
          answer={answer}
          feed={feed}
          onLeave={leave}
        />
      </div>
      {gameOver && <GameOver room={room} ranking={ranking} songs={songs} isHost={isHost} onLeave={leave} />}
    </>
  );
}
