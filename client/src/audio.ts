type Track = { source: AudioBufferSourceNode; gain: GainNode };

let sharedContext: AudioContext | undefined;

export function audioContext(): AudioContext {
  sharedContext ??= new AudioContext();
  return sharedContext;
}

let sharedTap: { input: DelayNode; analyser: AnalyserNode } | undefined;

/** Everything the game plays (menu music and songs) also goes here, for the equalizer background. */
function levelsTap() {
  if (!sharedTap) {
    const ctx = audioContext();
    const input = ctx.createDelay(1);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.minDecibels = -100;
    analyser.maxDecibels = -10;
    analyser.smoothingTimeConstant = 0.6;
    input.connect(analyser);
    sharedTap = { input, analyser };
  }
  return sharedTap;
}

export function audioAnalyser(): AnalyserNode {
  return levelsTap().analyser;
}

const MIN_HZ = 40;
const MAX_HZ = 16000;
// Music is far quieter in the highs. Each octave up is lifted by this much (of 255), so the bars span the range.
const TILT_PER_OCTAVE = 11;
let levels: Uint8Array<ArrayBuffer> | undefined;

/**
 * Fills `peaks` with how loud each bar is right now, 0 to 1, from the lowest notes to the highest. Hearing is
 * logarithmic: each bar spans the same musical interval, so the low notes aren't squeezed.
 */
export function readPeaks(peaks: Float32Array) {
  const analyser = audioAnalyser();
  levels ??= new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(levels);
  const hzPerBin = analyser.context.sampleRate / analyser.fftSize;
  const edge = (bar: number) => (MIN_HZ * (MAX_HZ / MIN_HZ) ** (bar / peaks.length)) / hzPerBin;
  for (let bar = 0; bar < peaks.length; bar++) {
    const from = Math.floor(edge(bar));
    const to = Math.max(from + 1, Math.floor(edge(bar + 1)));
    const raw = Math.max(...levels.subarray(from, to));
    peaks[bar] = raw && Math.min(1, (raw + Math.log2(edge(bar) / edge(0)) * TILT_PER_OCTAVE) / 255);
  }
}

/**
 * The analyser hears the sound before the speakers play it (by 200 ms or more on Bluetooth). Holding it back
 * by that latency keeps the bars on what you hear. Output devices can change, so this is called every frame.
 */
export function alignLevelsToSpeakers() {
  const { input } = levelsTap();
  const ctx = audioContext();
  const latency = Math.min(1, (ctx.baseLatency || 0) + (ctx.outputLatency || 0));
  if (Math.abs(input.delayTime.value - latency) > 0.01) input.delayTime.value = latency;
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

const SONG_VOLUME = 0.5;

/** Plays all stems of a song together and in sync: looped in rounds, or once with seeking in the Song Library. */
class StemPlayer {
  private master?: GainNode;
  private buffers?: Promise<AudioBuffer[]>;
  private loaded?: AudioBuffer[];
  private tracks: Track[] = [];
  private generation = 0;
  private loop = true;
  // Context time at which the song's 0 s mark plays, and where it is paused.
  private origin = 0;
  private offset = 0;
  private playing = false;
  private endTimer?: number;
  private listeners = new Set<() => void>();
  /** Called when a song played with loop off reaches its end. */
  onEnded?: () => void;

  /** Called when a song starts or stops playing. */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  private setPlaying(playing: boolean) {
    if (this.playing === playing) return;
    this.playing = playing;
    this.listeners.forEach((fn) => fn());
  }

  private output(): GainNode {
    if (!this.master) {
      const ctx = audioContext();
      this.master = ctx.createGain();
      this.master.gain.value = SONG_VOLUME;
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
    this.setPlaying(true);
    this.tracks = this.loaded.map((buffer) => {
      const gain = ctx.createGain();
      gain.connect(this.output());
      gain.connect(levelsTap().input);
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
        this.setPlaying(false);
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

  isPlaying = () => this.playing;

  pause() {
    if (!this.playing) return;
    const at = this.position();
    this.release();
    this.setPlaying(false);
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

  stop() {
    this.generation++;
    this.release();
    this.loaded = undefined;
    this.setPlaying(false);
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

const BG_URL = '/audio/bg-loop.flac';
const BG_VOLUME = 0.5;

/** Background loop. AudioBufferSourceNode.loop is sample-accurate, so there is no gap. */
class BgMusic {
  private wanted = false;
  private buffer?: Promise<AudioBuffer>;
  private current?: Track;

  setWanted(wanted: boolean) {
    this.wanted = wanted;
    void this.sync();
  }

  async sync() {
    if (!this.wanted) {
      this.fadeOut();
      return;
    }
    const ctx = audioContext();
    if (this.current || ctx.state !== 'running') return;

    this.buffer ??= fetch(BG_URL)
      .then((res) => res.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data));
    const buffer = await this.buffer.catch(() => undefined);
    if (!buffer || this.current || !this.wanted) return;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(BG_VOLUME, ctx.currentTime + 1);
    gain.connect(ctx.destination);
    gain.connect(levelsTap().input);
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
    // Off the equalizer straight away: a song starting now has the bars to itself while this fades.
    gain.disconnect(levelsTap().input);
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
