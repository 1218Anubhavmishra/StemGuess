export type Player = { id: string; name: string; score: number; guessed: boolean; attempted: boolean };

export type RoomState = {
  code: string;
  hostId: string;
  state: 'lobby' | 'playing' | 'finished';
  round: number;
  totalRounds: number;
  maxPlayers: number;
  players: Player[];
};

export type StemInfo = { name: string; url: string };

export type Phase = 'lobby' | 'prepare' | 'playing' | 'roundEnd' | 'gameOver';

export type FeedItem = {
  id: number;
  type: 'correct' | 'nobody' | 'guess' | 'system';
  name?: string;
  text?: string;
};

export type Ack = {
  ok: boolean;
  error?: string;
  code?: string;
  playerId?: string;
  result?: 'correct' | 'close' | 'wrong';
  songs?: number;
};

export const SONG_LIMITS = { min: 3, max: 10 };
export const PLAYER_LIMITS = { min: 2, max: 10 };
