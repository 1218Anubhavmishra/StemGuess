import { useEffect, useRef } from 'react';
import { alignLevelsToSpeakers, audioAnalyser } from '../audio';

const BARS = 40;
// Drawn small and stretched over the page: the bars are soft anyway, and the blur stays cheap.
const WIDTH = 240;
const HEIGHT = 135;
const BAR_WIDTH = 4;
const MIN_HZ = 40;
const MAX_HZ = 16000;
// Bars stop short of the pinned header, and rest at a sliver during silence.
const TALLEST = 0.7;
const RESTING = 0.02;
// Music is far quieter in the highs. Each octave up is lifted by this much (of 255), so the bars span the page.
const TILT_PER_OCTAVE = 11;

/** The page background: a live, blurred equalizer of whatever the game is playing. */
export default function EqualizerBackground() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent');

    const analyser = audioAnalyser();
    const levels = new Uint8Array(analyser.frequencyBinCount);
    const hzPerBin = analyser.context.sampleRate / analyser.fftSize;
    // Hearing is logarithmic: each bar spans the same musical interval, so the low notes aren't squeezed.
    const edge = (bar: number) => (MIN_HZ * (MAX_HZ / MIN_HZ) ** (bar / BARS)) / hzPerBin;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

    let frame = 0;
    const draw = () => {
      alignLevelsToSpeakers();
      analyser.getByteFrequencyData(levels);
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      for (let bar = 0; bar < BARS; bar++) {
        const from = Math.floor(edge(bar));
        const to = Math.max(from + 1, Math.floor(edge(bar + 1)));
        const raw = still ? 0 : Math.max(...levels.subarray(from, to));
        const peak = raw && Math.min(1, (raw + Math.log2(edge(bar) / edge(0)) * TILT_PER_OCTAVE) / 255);
        const height = Math.max(RESTING, peak ** 3 * TALLEST) * HEIGHT;
        // Centred on the page's middle, growing up and down from it.
        ctx.fillRect((bar * WIDTH) / BARS + 0.5, (HEIGHT - height) / 2, BAR_WIDTH, height);
      }
      if (!still) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="equalizer-bg" aria-hidden>
      <canvas ref={canvas} width={WIDTH} height={HEIGHT} />
    </div>
  );
}
