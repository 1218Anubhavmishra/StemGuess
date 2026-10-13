export type Player = { id: string; name: string; score: number; guessed: boolean; attempted: boolean; connected: boolean };

export type RoomState = {
  code: string;
  hostId: string;
  state: 'lobby' | 'playing' | 'finished';
  round: number;
  totalRounds: number;
  maxPlayers: number;
  library: Library;
  localTracks: number;
  players: Player[];
  spectators: { id: string; name: string }[];
};

export type ServerLibrary = 'demo' | 'cc' | 'hits';
export type Library = ServerLibrary | 'local';

export type PracticeRound = {
  id: number;
  urls: string[];
  options: string[];
  correct: number;
  title: string;
  artist: string;
  credit?: Credit | null;
};

export type Phase = 'lobby' | 'prepare' | 'playing' | 'roundEnd' | 'gameOver';

export type FeedItem = {
  id: number;
  type: 'correct' | 'nobody' | 'system';
  name?: string;
  text?: string;
  points?: number;
};

export type Credit = { text: string; url?: string; license?: string; licenseUrl?: string };

export type RoundAnswer = {
  title: string;
  artist: string;
  credit?: Credit | null;
  correct: number;
  isLast: boolean;
  points: Record<string, number>;
};

export type Ack = {
  ok: boolean;
  error?: string;
  code?: string;
  playerId?: string;
  token?: string;
  result?: 'correct' | 'wrong';
  spectator?: boolean;
  canSpectate?: boolean;
  libraries?: Record<ServerLibrary, number>;
  round?: PracticeRound;
  songs?: LibrarySong[];
  urls?: string[];
};

export type LibrarySong = { id: number; title: string; artist: string; credit?: Credit | null };

export const GITHUB_URL = 'https://github.com/1218Anubhavmishra';

export const SONG_LIMITS = { min: 3, max: 10 };
export const PLAYER_LIMITS = { min: 2, max: 10 };
/** The host's own songs: the game draws at random from at least this many times its length. */
export const LOCAL_POOL_FACTOR = 2;
