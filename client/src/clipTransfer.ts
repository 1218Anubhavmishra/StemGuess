import { getTracks } from './localLibrary';
import { request, socket } from './socket';

/**
 * Moves the host's song clips to the other players' devices.
 * First choice is a direct WebRTC data channel (the audio never touches our server). Networks that
 * block direct connections fall back to relaying chunks through the game server, which forwards
 * them without storing anything.
 */

const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const DIRECT_TIMEOUT_MS = 7000;
// Safari and older Chromes reject larger data channel messages.
const CHANNEL_CHUNK = 16 * 1024;
const CHANNEL_HIGH_WATER = 1024 * 1024;
const RELAY_CHUNK = 128 * 1024;

type Signal = { offer?: RTCSessionDescriptionInit; answer?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
type Peer = { pc: RTCPeerConnection; queue: Promise<void> };

let order: number[] = [];
let orderKey = '';
let hostId = '';
let reportedReady = false;
const clips = new Map<number, ArrayBuffer>();
const waiters = new Map<number, ((clip: ArrayBuffer) => void)[]>();
const peers = new Map<string, Peer>();
const relayParts = new Map<number, ArrayBuffer[]>();

/** The clip for a round, as soon as it has arrived on this device. */
export function getClip(position: number): Promise<ArrayBuffer> {
  const clip = clips.get(position);
  if (clip) return Promise.resolve(clip);
  return new Promise((resolve) => waiters.set(position, [...(waiters.get(position) ?? []), resolve]));
}

function store(position: number, clip: ArrayBuffer) {
  if (clips.has(position)) return;
  clips.set(position, clip);
  waiters.get(position)?.forEach((resolve) => resolve(clip));
  waiters.delete(position);
  reportIfReady();
}

function reportIfReady() {
  if (reportedReady || socket.id === hostId || !order.length || clips.size < order.length) return;
  reportedReady = true;
  void request('local_ready');
}

function joinChunks(parts: ArrayBuffer[]): ArrayBuffer {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(new Uint8Array(part), offset);
    offset += part.byteLength;
  }
  return out.buffer;
}

function signal(to: string, data: Signal) {
  void request('rtc_signal', { to, data });
}

function newPeer(id: string): Peer {
  peers.get(id)?.pc.close();
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.onicecandidate = (e) => e.candidate && signal(id, { candidate: e.candidate.toJSON() });
  const peer = { pc, queue: Promise.resolve() };
  peers.set(id, peer);
  return peer;
}

function closePeer(id: string) {
  peers.get(id)?.pc.close();
  peers.delete(id);
}

// ----- receiving -----

function receiveOn(channel: RTCDataChannel) {
  channel.binaryType = 'arraybuffer';
  let current: { pos: number; size: number; parts: ArrayBuffer[]; received: number } | null = null;
  channel.onmessage = (e) => {
    if (typeof e.data === 'string') {
      const { pos, size } = JSON.parse(e.data) as { pos: number; size: number };
      current = { pos, size, parts: [], received: 0 };
      return;
    }
    if (!current) return;
    current.parts.push(e.data as ArrayBuffer);
    current.received += (e.data as ArrayBuffer).byteLength;
    if (current.received >= current.size) {
      store(current.pos, joinChunks(current.parts));
      current = null;
    }
  };
}

async function handleSignal({ pc }: Peer, from: string, data: Signal) {
  if (data.offer) {
    pc.ondatachannel = (e) => receiveOn(e.channel);
    await pc.setRemoteDescription(data.offer);
    await pc.setLocalDescription(await pc.createAnswer());
    signal(from, { answer: pc.localDescription!.toJSON() });
  }
  if (data.answer) await pc.setRemoteDescription(data.answer);
  if (data.candidate) await pc.addIceCandidate(data.candidate).catch(() => undefined);
}

socket.on('rtc_signal', ({ from, data }: { from: string; data: Signal }) => {
  const peer = data.offer ? newPeer(from) : peers.get(from);
  if (!peer) return;
  // Signals for one peer must be applied in order (an ICE candidate can't precede its offer).
  peer.queue = peer.queue
    .then(() => handleSignal(peer, from, data))
    .catch((err) => console.warn('WebRTC signal failed', err));
});

socket.on('clip_chunk', (p: { pos: number; seq: number; total: number; chunk: ArrayBuffer }) => {
  if (clips.has(p.pos)) return;
  const parts = relayParts.get(p.pos) ?? new Array<ArrayBuffer>(p.total);
  parts[p.seq] = p.chunk;
  relayParts.set(p.pos, parts);
  if (parts.filter(Boolean).length === p.total) {
    relayParts.delete(p.pos);
    store(p.pos, joinChunks(parts));
  }
});

socket.on('local_order', (p: { order: number[]; host: string }) => {
  const key = `${p.host}:${p.order.join(',')}`;
  hostId = p.host;
  reportedReady = false;
  if (key !== orderKey) {
    orderKey = key;
    order = p.order;
    clips.clear();
    relayParts.clear();
  }
  if (socket.id === hostId) {
    const tracks = getTracks();
    order.forEach((index, position) => tracks[index] && store(position, tracks[index].clip));
  }
  reportIfReady();
});

// ----- sending (host) -----

function waitForDrain(channel: RTCDataChannel, below: number): Promise<void> {
  if (channel.bufferedAmount <= below) return Promise.resolve();
  return new Promise((resolve, reject) => {
    channel.bufferedAmountLowThreshold = below;
    channel.onbufferedamountlow = () => resolve();
    channel.onclose = () => reject(new Error('channel closed'));
  });
}

async function sendDirect(to: string, items: [number, ArrayBuffer][]) {
  const { pc } = newPeer(to);
  const channel = pc.createDataChannel('clips', { ordered: true });
  channel.binaryType = 'arraybuffer';
  const opened = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('direct connection timed out')), DIRECT_TIMEOUT_MS);
    channel.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  await pc.setLocalDescription(await pc.createOffer());
  signal(to, { offer: pc.localDescription!.toJSON() });
  await opened;

  for (const [pos, clip] of items) {
    channel.send(JSON.stringify({ pos, size: clip.byteLength }));
    for (let offset = 0; offset < clip.byteLength; offset += CHANNEL_CHUNK) {
      if (channel.readyState !== 'open') throw new Error('channel closed');
      await waitForDrain(channel, CHANNEL_HIGH_WATER);
      channel.send(clip.slice(offset, offset + CHANNEL_CHUNK));
    }
  }
  await waitForDrain(channel, 0);
  setTimeout(() => closePeer(to), 2000);
}

async function sendRelayed(to: string, items: [number, ArrayBuffer][]) {
  for (const [pos, clip] of items) {
    const total = Math.ceil(clip.byteLength / RELAY_CHUNK);
    for (let seq = 0; seq < total; seq++) {
      const chunk = clip.slice(seq * RELAY_CHUNK, (seq + 1) * RELAY_CHUNK);
      const ack = await request('relay_clip', { to, pos, seq, total, size: clip.byteLength, chunk });
      if (!ack.ok) throw new Error(ack.error ?? 'relay failed');
    }
  }
}

async function sendClips(to: string) {
  const tracks = getTracks();
  const items = order
    .map((index, position) => [position, tracks[index]?.clip] as [number, ArrayBuffer | undefined])
    .filter((item): item is [number, ArrayBuffer] => !!item[1]);
  if (!items.length) return;
  try {
    await sendDirect(to, items);
  } catch (err) {
    console.info(`Direct transfer to ${to} failed (${(err as Error).message}); relaying through the server.`);
    closePeer(to);
    await sendRelayed(to, items).catch((e) => console.error('Relay failed', e));
  }
}

socket.on('local_send', ({ to }: { to: string[] }) => {
  to.forEach((id) => void sendClips(id));
});
