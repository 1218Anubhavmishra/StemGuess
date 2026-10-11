import { audioContext } from './audio';

/** Songs the host added from their own device. Kept in memory only; never uploaded to the server. */
export type LocalTrack = { id: number; title: string; artist: string; file: File };

export const CLIP_SECONDS = 15;
// Mono 22.05 kHz 16-bit WAV: ~660 KB per clip, small enough to send to every player quickly.
const CLIP_RATE = 22050;
const EDGE_SKIP = 0.1;

let nextId = 1;
let tracks: LocalTrack[] = [];
// Name of the folder the songs came from ('' when picked as loose files).
let folder = '';
const listeners = new Set<() => void>();

export const getTracks = () => tracks;
export const getFolder = () => folder;

export function setTracks(next: LocalTrack[], from = '') {
  tracks = next;
  folder = from;
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

const JUNK = [
  /\((?:www\.)?[\w-]+\.(?:com|in|net|org|info|co|cc|me|pk|fm|io|mobi)[^)]*\)/gi,
  /\[[^\]]*\]/g,
  /(?:-\s*)?(?:www\.)?[\w-]+(?:\.[\w-]+)*\.(?:com|in|net|org|info|cc|me|pk|fm|mobi)\b/gi,
  /\(\d+k(?:bps)?\)|\b\d{3}\s?kbps\b/gi,
  /\((?:[^)]*\b(?:feat|ft|featuring|official|lyrics?|audio|video|remix|version|explicit|remaster(?:ed)?)\b[^)]*)\)/gi,
  /\s(?:feat\.?|ft\.?|featuring)\s.*$/i,
];

/** "02_Artist - Song (Official Video)[320kbps].mp3" -> { artist: "Artist", title: "Song" } */
export function guessName(fileName: string): { artist: string; title: string } {
  let text = fileName.replace(/\.[^.]+$/, '');
  for (const pattern of JUNK) text = text.replace(pattern, ' ');
  text = text.replace(/^\s*\d{1,3}\s*[-_.)]\s*/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const [artist, ...rest] = text.split(' - ');
  const title = rest.length ? rest.join(' - ') : artist;
  return { artist: rest.length ? artist.trim() : '', title: title.replace(/^[\s\-.,]+|[\s\-.,]+$/g, '') || fileName };
}

/** Start (s) of the loudest CLIP_SECONDS stretch, skipping intros and outros. */
function loudestWindow(buffer: AudioBuffer): number {
  if (buffer.duration <= CLIP_SECONDS) return 0;
  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  const energy: number[] = [];
  for (let second = 0; (second + 1) * rate <= data.length; second++) {
    let sum = 0;
    for (let i = second * rate; i < (second + 1) * rate; i += 8) sum += data[i] * data[i];
    energy.push(sum);
  }
  if (energy.length <= CLIP_SECONDS) return 0;
  const first = Math.floor(energy.length * EDGE_SKIP);
  const last = Math.max(first, Math.floor(energy.length * (1 - EDGE_SKIP)) - CLIP_SECONDS);
  let best = first;
  let bestSum = -1;
  for (let start = first; start <= last; start++) {
    let sum = 0;
    for (let i = start; i < start + CLIP_SECONDS; i++) sum += energy[i];
    if (sum > bestSum) [best, bestSum] = [start, sum];
  }
  return best;
}

function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (offset: number, value: string) => [...value].forEach((c, i) => out.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  out.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); // PCM
  out.setUint16(22, 1, true); // mono
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  text(36, 'data');
  out.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return out.buffer;
}

export function makeTrack(file: File): LocalTrack {
  return { id: nextId++, ...guessName(file.name), file };
}

/** Decodes an audio file on this device and cuts its loudest 15 s into a small WAV clip. */
async function cutClip(file: File): Promise<ArrayBuffer> {
  const decoded = await audioContext().decodeAudioData(await file.arrayBuffer());
  const start = loudestWindow(decoded);
  const length = Math.min(CLIP_SECONDS, decoded.duration - start);
  const offline = new OfflineAudioContext(1, Math.ceil(length * CLIP_RATE), CLIP_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0, start, length);
  const rendered = await offline.startRendering();
  return encodeWav(rendered.getChannelData(0), CLIP_RATE);
}

const clipCache = new WeakMap<File, Promise<ArrayBuffer>>();

/**
 * The track's clip, cut the first time the game draws it. A file the browser can't decode gives a
 * second of silence, so the other players' devices still get a clip for every round.
 */
export function clipOf(track: LocalTrack): Promise<ArrayBuffer> {
  let clip = clipCache.get(track.file);
  if (!clip) {
    clip = cutClip(track.file).catch((err) => {
      console.warn(`Couldn't read ${track.file.name}`, err);
      return encodeWav(new Float32Array(CLIP_RATE), CLIP_RATE);
    });
    clipCache.set(track.file, clip);
  }
  return clip;
}
