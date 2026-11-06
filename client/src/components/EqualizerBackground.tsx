import { useEffect, useRef } from 'react';
import { alignLevelsToSpeakers, readPeaks } from '../audio';

// The distance between neighbouring dots, the same across and up, whatever the screen's size.
const DOT_PITCH = 9;
const DOT_RADIUS = 2;
// The tallest a column can reach, as a share of the screen's height.
const MAX_HEIGHT = 0.6;
// How far up the screen the colours finish changing, so the peaks of a normal level reach the top colour.
const GRADIENT_HEIGHT = 0.5;
// Peaks are shaped so quiet bands stay low and loud ones stand out.
const PEAK_CURVE = 1.8;
// How much of the way to a new level a column moves each frame: up quickly, back down slowly.
const RISE = 0.5;
const FALL = 0.08;
// How finely the sound is split. The screen's columns are stretched across the bands that have sound in them.
const BANDS = 64;
// How many bands a frame the stretch can shrink by, so one quiet moment doesn't make the whole picture jump.
const REACH_FALL = 0.1;

/** The page background: columns of dots rising from the bottom edge, in time with whatever the game is playing. */
export default function EqualizerBackground() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Every dot, drawn once in its colour. Each frame only uncovers as many of a column's dots as its level calls for.
    const dots = document.createElement('canvas');
    let scale = 1;
    let columns = 0;
    let rows = 0;
    let left = 0;
    const bands = new Float32Array(BANDS);
    let reach = 0;
    let heights = new Float32Array(0);

    const paintDots = () => {
      scale = Math.min(2, window.devicePixelRatio || 1);
      const [width, height] = [innerWidth, innerHeight];
      el.width = dots.width = Math.round(width * scale);
      el.height = dots.height = Math.round(height * scale);
      const count = Math.floor(width / DOT_PITCH);
      if (count !== columns) {
        columns = count;
        heights = new Float32Array(columns);
      }
      rows = Math.floor((height * MAX_HEIGHT) / DOT_PITCH);
      left = (width - columns * DOT_PITCH) / 2;

      const paint = dots.getContext('2d');
      if (!paint) return;
      const style = getComputedStyle(document.documentElement);
      const fill = paint.createLinearGradient(0, height, 0, height * (1 - GRADIENT_HEIGHT));
      fill.addColorStop(0, style.getPropertyValue('--eq-low').trim());
      fill.addColorStop(1, style.getPropertyValue('--eq-high').trim());
      paint.setTransform(scale, 0, 0, scale, 0, 0);
      paint.fillStyle = fill;
      paint.beginPath();
      for (let column = 0; column < columns; column++) {
        const x = left + (column + 0.5) * DOT_PITCH;
        for (let row = 0; row < rows; row++) {
          const y = height - (row + 0.5) * DOT_PITCH;
          paint.moveTo(x + DOT_RADIUS, y);
          paint.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
        }
      }
      paint.fill();
    };
    paintDots();
    const theme = matchMedia('(prefers-color-scheme: dark)');
    theme.addEventListener('change', paintDots);

    let frame = 0;
    const draw = () => {
      if (el.width !== Math.round(innerWidth * scale) || el.height !== Math.round(innerHeight * scale)) paintDots();
      alignLevelsToSpeakers();
      readPeaks(bands);
      // Music rarely fills the whole range (the menu music has no high notes at all), so the columns span what's there.
      let top = BANDS - 1;
      while (top > 0 && !bands[top]) top--;
      reach = Math.max(top, reach - REACH_FALL, 0);

      ctx.clearRect(0, 0, el.width, el.height);
      const pitch = DOT_PITCH * scale;
      for (let column = 0; column < columns; column++) {
        const at = (reach * column) / Math.max(1, columns - 1);
        const below = Math.floor(at);
        const level = bands[below] + (bands[Math.min(below + 1, BANDS - 1)] - bands[below]) * (at - below);
        const target = level ** PEAK_CURVE;
        heights[column] += (target - heights[column]) * (target > heights[column] ? RISE : FALL);
        // While anything is playing, the bottom row of dots spans the whole screen.
        const shown = Math.max(top > 0 ? 1 : 0, Math.round(heights[column] * rows)) * pitch;
        if (!shown) continue;
        const x = (left + column * DOT_PITCH) * scale;
        ctx.drawImage(dots, x, el.height - shown, pitch, shown, x, el.height - shown, pitch, shown);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      theme.removeEventListener('change', paintDots);
    };
  }, []);

  return (
    <div className="equalizer-bg" aria-hidden>
      <canvas ref={canvas} />
    </div>
  );
}
