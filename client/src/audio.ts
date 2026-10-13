type Track = { source: AudioBufferSourceNode; gain: GainNode };

let sharedContext: AudioContext | undefined;

export function audioContext(): AudioContext {
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

const DEFAULT_VOLUME = 0.2;

/** Plays all stems of a song together and in sync: looped in rounds, or once with seeking in the Song Library. */
class StemPlayer {
  private master?: GainNode;
  private buffers?: Promise<AudioBuffer[]>;
  private loaded?: AudioBuffer[];
  private tracks: Track[] = [];
  private generation = 0;
  private volume = DEFAULT_VOLUME;
  private muted = false;
  private loop = true;
  // Context time at which the song's 0 s mark plays, and where it is paused.
  private origin = 0;
  private offset = 0;
  private playing = false;
  private endTimer?: number;
  /** Called when a song played with loop off reaches its end. */
  onEnded?: () => void;

  private output(): GainNode {
    if (!this.master) {
      const ctx = audioContext();
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(ctx.destination);
    }
    return this.master;
  }

  /** One clip already on this device (the host's own song). */
  prepareClip(clip: Promise<ArrayBuffer>) {
    this.stop();
    // decodeAudioData detaches its input, and the host may still need to send this clip to others.
    this.buffers = clip.then((data) => audioContext().decodeAudioData(data.slice(0))).then((b) => [b]);
    this.buffers.catch((err) => console.error(err));
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

  async start({ loop = true } = {}) {
    const generation = this.generation;
    const buffers = await this.buffers?.catch(() => undefined);
    if (!buffers || generation !== this.generation) return;
    this.loaded = buffers;
    this.loop = loop;
    this.launch(0);
  }

  private launch(offset: number) {
    if (!this.loaded) return;
    this.release();
    const ctx = audioContext();
    void ctx.resume();
    const startAt = ctx.currentTime + 0.1;
    this.origin = startAt - offset;
    this.offset = offset;
    this.playing = true;
    this.tracks = this.loaded.map((buffer) => {
      const gain = ctx.createGain();
      gain.connect(this.output());
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = this.loop;
      source.connect(gain);
      source.start(startAt, offset);
      return { source, gain };
    });
    if (!this.loop) {
      this.endTimer = window.setTimeout(() => {
        this.release();
        this.playing = false;
        this.offset = 0;
        this.onEnded?.();
      }, (this.duration() - offset + 0.1) * 1000);
    }
  }

  /** Length of the loaded song in seconds (0 until it has started once). */
  duration() {
    return Math.max(0, ...(this.loaded ?? []).map((b) => b.duration));
  }

  /** Current point in the song, in seconds. */
  position() {
    const length = this.duration();
    if (!this.playing || !length) return this.offset;
    const t = Math.max(0, audioContext().currentTime - this.origin);
    return this.loop ? t % length : Math.min(t, length);
  }

  isPlaying() {
    return this.playing;
  }

  pause() {
    if (!this.playing) return;
    const at = this.position();
    this.release();
    this.playing = false;
    this.offset = at;
  }

  resume() {
    if (!this.playing) this.launch(this.offset >= this.duration() ? 0 : this.offset);
  }

  seek(seconds: number) {
    const at = Math.min(Math.max(0, seconds), this.duration());
    if (this.playing) this.launch(at);
    else this.offset = at;
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

  resetSettings() {
    this.volume = DEFAULT_VOLUME;
    this.setMuted(false);
  }

  stop() {
    this.generation++;
    this.release();
    this.loaded = undefined;
    this.playing = false;
    this.offset = 0;
  }

  private release() {
    window.clearTimeout(this.endTimer);
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
