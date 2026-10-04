type Track = { source: AudioBufferSourceNode; gain: GainNode };

/**
 * Plays all stems of a round in sync (looped) and fades each one in when revealed.
 * The AudioContext must be created from a user gesture (see unlock) for mobile/Capacitor.
 */
class StemPlayer {
  private ctx?: AudioContext;
  private master?: GainNode;
  private buffers?: Promise<AudioBuffer[]>;
  private tracks: Track[] = [];
  private revealed = new Set<number>();
  private generation = 0;
  private volume = 0.8;

  unlock() {
    this.context();
    void this.ctx?.resume();
  }

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  prepare(urls: string[]) {
    this.stop();
    const ctx = this.context();
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

    const ctx = this.context();
    void ctx.resume();
    const startAt = ctx.currentTime + 0.1;
    this.tracks = buffers.map((buffer, index) => {
      const gain = ctx.createGain();
      gain.gain.value = this.revealed.has(index) ? 1 : 0;
      gain.connect(this.master!);
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
    if (track && this.ctx) track.gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.3);
  }

  revealAll(count: number) {
    for (let i = 0; i < count; i++) this.reveal(i);
  }

  setVolume(value: number) {
    this.volume = value;
    if (this.master) this.master.gain.value = value;
  }

  getVolume() {
    return this.volume;
  }

  stop() {
    this.generation++;
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

export const stemPlayer = new StemPlayer();
