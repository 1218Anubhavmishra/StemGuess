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
};

export type Library = 'demo' | 'cc' | 'local';

export type Phase = 'lobby' | 'prepare' | 'playing' | 'roundEnd' | 'gameOver';

export type FeedItem = {
  id: number;
  type: 'correct' | 'nobody' | 'system';
  name?: string;
  text?: string;
  points?: number;
};

export type RoundAnswer = {
  title: string;
  artist: string;
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
  libraries?: Record<'demo' | 'cc', number>;
};

export const SONG_LIMITS = { min: 3, max: 10 };
export const PLAYER_LIMITS = { min: 2, max: 10 };
