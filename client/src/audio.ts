type Track = { source: AudioBufferSourceNode; gain: GainNode };

let sharedContext: AudioContext | undefined;

function audioContext(): AudioContext {
  sharedContext ??= new AudioContext();
  return sharedContext;
}

/** Browsers (and Capacitor webviews) only start audio after a user gesture. */
export function unlockAudio() {
  void audioContext()
    .resume()
    .then(() => bgMusic.sync());
}

for (const event of ['pointerdown', 'keydown', 'touchstart']) {
  window.addEventListener(event, unlockAudio, { passive: true });
}

/**
 * Plays all stems of a round in sync (looped) and fades each one in when revealed.
 */
class StemPlayer {
  private master?: GainNode;
  private buffers?: Promise<AudioBuffer[]>;
  private tracks: Track[] = [];
  private revealed = new Set<number>();
  private generation = 0;
  private volume = 0.2;
  private muted = false;
  private startedAt?: number;
  private clipDuration = 0;

  private output(): GainNode {
    if (!this.master) {
      const ctx = audioContext();
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(ctx.destination);
    }
    return this.master;
  }

  prepare(urls: string[]) {
    this.stop();
    const ctx = audioContext();
    this.buffers = Promise.all(
      urls.map(async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to load ${url}`);
        return ctx.decodeAudioData(await res.arrayBuffer());
      }),
    );
    this.buffers.catch((err) => console.error(err));
  }

  async start() {
    const generation = this.generation;
    const buffers = await this.buffers?.catch(() => undefined);
    if (!buffers || generation !== this.generation) return;

    const ctx = audioContext();
    void ctx.resume();
    const startAt = ctx.currentTime + 0.1;
    this.startedAt = startAt;
    this.clipDuration = Math.max(...buffers.map((b) => b.duration));
    this.tracks = buffers.map((buffer, index) => {
      const gain = ctx.createGain();
      gain.gain.value = this.revealed.has(index) ? 1 : 0;
      gain.connect(this.output());
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      source.start(startAt);
      return { source, gain };
    });
  }

  reveal(index: number) {
    this.revealed.add(index);
    const track = this.tracks[index];
    if (track) track.gain.gain.setTargetAtTime(1, audioContext().currentTime, 0.3);
  }

  setVolume(value: number) {
    this.volume = value;
    if (this.master && !this.muted) this.master.gain.value = value;
  }

  getVolume() {
    return this.volume;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
  }

  isMuted() {
    return this.muted;
  }

  /** Playback position within the (looping) clip, or null when nothing is playing. */
  progress(): { position: number; duration: number } | null {
    if (this.startedAt === undefined || !this.clipDuration) return null;
    const elapsed = Math.max(0, audioContext().currentTime - this.startedAt);
    return { position: elapsed % this.clipDuration, duration: this.clipDuration };
  }

  stop() {
    this.generation++;
    this.startedAt = undefined;
    for (const { source, gain } of this.tracks) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
      source.disconnect();
      gain.disconnect();
    }
    this.tracks = [];
    this.revealed.clear();
  }
}

const BG_URL = '/audio/bg-loop.wav';
const BG_VOLUME = 0.35;
const MUTE_KEY = 'stemguess:musicMuted';

/** Menu background loop. AudioBufferSourceNode.loop is sample-accurate, so there is no gap. */
class BgMusic {
  private wanted = false;
  private muted = localStorage.getItem(MUTE_KEY) === '1';
  private buffer?: Promise<AudioBuffer>;
  private current?: Track;

  isMuted() {
    return this.muted;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    void this.sync();
  }

  setWanted(wanted: boolean) {
    this.wanted = wanted;
    void this.sync();
  }

  async sync() {
    if (!this.wanted || this.muted) {
      this.fadeOut();
      return;
    }
    const ctx = audioContext();
    if (this.current || ctx.state !== 'running') return;

    this.buffer ??= fetch(BG_URL)
      .then((res) => res.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data));
    const buffer = await this.buffer.catch(() => undefined);
    if (!buffer || this.current || !this.wanted || this.muted) return;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(BG_VOLUME, ctx.currentTime + 1);
    gain.connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    this.current = { source, gain };
  }

  private fadeOut() {
    if (!this.current) return;
    const { source, gain } = this.current;
    this.current = undefined;
    const now = audioContext().currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.6);
    source.stop(now + 0.7);
    source.onended = () => gain.disconnect();
  }
}

export const stemPlayer = new StemPlayer();
export const bgMusic = new BgMusic();
