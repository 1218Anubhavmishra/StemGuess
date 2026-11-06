import type { FacetRow } from './filters';

export type Player = { id: string; name: string; score: number; guessed: boolean; attempted: boolean; connected: boolean };

export type RoomState = {
  code: string;
  hostId: string;
  state: 'lobby' | 'playing' | 'finished';
  round: number;
  totalRounds: number;
  maxPlayers: number;
  library: Library;
  /** Only songs by these artists, in these genres and languages play; empty means any. */
  artists: string[];
  genres: string[];
  languages: string[];
  /** Only songs whose title, artist, genre or language contains this play; empty means any. */
  search: string;
  /** Songs in the library matching the filters and search (null until counted). */
  poolSize: number | null;
  players: Player[];
  spectators: { id: string; name: string }[];
};

/** The game's only song library: previews of popular hits. */
export type ServerLibrary = 'hits';
export type Library = ServerLibrary;

export type Phase = 'lobby' | 'prepare' | 'playing' | 'roundEnd' | 'gameOver';

export type FeedItem = {
  id: number;
  type: 'correct' | 'nobody' | 'system';
  name?: string;
  text?: string;
};

/** A song played in the game, revealed with the final scores. */
export type GameSong = { title: string; artist: string; credit?: Credit | null; urls: string[] };

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
  songs?: LibrarySong[];
  facets?: FacetRow[];
  urls?: string[];
};

export type LibrarySong = {
  id: number;
  title: string;
  artist: string;
  credit?: Credit | null;
  genre?: string;
  language?: string;
};

export const SONG_LIMITS = { min: 3, max: 10 };
export const PLAYER_LIMITS = { min: 2, max: 10 };
