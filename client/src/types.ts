export type Player = { id: string; name: string; score: number; guessed: boolean };

export type RoomState = {
  code: string;
  hostId: string;
  state: 'lobby' | 'playing' | 'finished';
  round: number;
  totalRounds: number;
  players: Player[];
};

export type StemInfo = { name: string; url: string };

export type Phase = 'lobby' | 'prepare' | 'playing' | 'roundEnd' | 'gameOver';

export type FeedItem = {
  id: number;
  type: 'correct' | 'guess' | 'system';
  name?: string;
  text?: string;
};

export type Ack = {
  ok: boolean;
  error?: string;
  code?: string;
  playerId?: string;
  result?: 'correct' | 'close' | 'wrong';
};
