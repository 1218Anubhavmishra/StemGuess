import { io } from 'socket.io-client';
import type { Ack } from './types';

export const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;

export const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });

export const serverUrl = (path: string) => new URL(path, SERVER_URL).href;

// Per-tab seat in a room, so a dropped connection or page reload can rejoin the same game.
type Session = { code: string; token: string };
const SESSION_KEY = 'stemguess:session';

export function saveSession(ack: Ack) {
  if (ack.ok && ack.code && ack.token) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code: ack.code, token: ack.token }));
}

export function loadSession(): Session | null {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export async function request(event: string, payload: object = {}): Promise<Ack> {
  try {
    return await socket.timeout(5000).emitWithAck(event, payload);
  } catch {
    return { ok: false, error: 'Server did not respond' };
  }
}
