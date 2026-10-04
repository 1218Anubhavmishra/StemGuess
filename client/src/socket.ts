import { io } from 'socket.io-client';
import type { Ack } from './types';

export const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;

export const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });

export const serverUrl = (path: string) => new URL(path, SERVER_URL).href;

export async function request(event: string, payload: object = {}): Promise<Ack> {
  try {
    return await socket.timeout(5000).emitWithAck(event, payload);
  } catch {
    return { ok: false, error: 'Server did not respond' };
  }
}
