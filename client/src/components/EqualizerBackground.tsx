import { useEffect, useRef } from 'react';
import { alignLevelsToSpeakers, readPeaks } from '../audio';

type Note = { x: number; y: number; angle: number; speed: number; size: number; glyph: string; age: number; life: number; wobble: number };

const GLYPHS = ['♪', '♫', '♩', '♬'];
const MAX_NOTES = 70;
const BARS = 24;
const TWO_PI = Math.PI * 2;
// What counts as a new note in the music: louder than the recent level, and not too soon after the last one.
const ONSET_RISE = 1.08;
const ONSET_MIN_LEVEL = 0.02;
const ONSET_GAP_SECONDS = 0.2;
// A held sound with no clear attacks still gives off a note this often.
const STEADY_GAP_SECONDS = 0.7;
const FADE_IN_SECONDS = 0.5;
const FADE_OUT_SECONDS = 1.8;
const WOBBLE_RADIANS = 0.35;

/**
 * Where the notes come from: the song's cover when one is on screen (the icon stands in for it until the answer
 * is revealed), and otherwise the game's icon in the header.
 */
function noteSource(): DOMRect | null {
  for (const selector of ['.ringed-cover', '.player-cover.current', '.logo-icon']) {
    for (const el of document.querySelectorAll(selector)) {
      if (el.closest('[inert]') || getComputedStyle(el).visibility !== 'visible') continue;
      const box = el.getBoundingClientRect();
      if (box.width && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth) return box;
    }
  }
  return null;
}

/** The page background: music notes drifting away from the cover, in time with whatever the game is playing. */
export default function EqualizerBackground() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // The notes take the browser theme's colour, and change with it.
    let ink = '';
    const applyTheme = () => {
      ink = getComputedStyle(document.documentElement).getPropertyValue('--eq-bar').trim();
    };
    applyTheme();
    const theme = matchMedia('(prefers-color-scheme: dark)');
    theme.addEventListener('change', applyTheme);

    const peaks = new Float32Array(BARS);
    const notes: Note[] = [];
    let recent = 0;
    let lastNote = 0;
    let before = performance.now();
    let frame = 0;

    const release = (loudness: number) => {
      const from = noteSource();
      if (!from || notes.length >= MAX_NOTES) return;
      const angle = Math.random() * TWO_PI;
      const radius = Math.min(from.width, from.height) / 2;
      notes.push({
        x: from.left + from.width / 2 + Math.cos(angle) * radius,
        y: from.top + from.height / 2 + Math.sin(angle) * radius,
        angle,
        speed: 45 + Math.random() * 50,
        size: 16 + Math.random() * 12 + Math.min(1, loudness * 4) * 14,
        glyph: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
        age: 0,
        life: 5 + Math.random() * 2.5,
        wobble: Math.random() * TWO_PI,
      });
    };

    const draw = (now: number) => {
      const seconds = Math.min(0.1, Math.max(0, now - before) / 1000);
      before = now;
      alignLevelsToSpeakers();
      readPeaks(peaks);
      let level = 0;
      for (const peak of peaks) level += peak ** 3;
      level /= BARS;
      const quiet = now - lastNote;
      const onset = level > recent * ONSET_RISE && quiet > ONSET_GAP_SECONDS * 1000;
      if (level > ONSET_MIN_LEVEL && (onset || quiet > STEADY_GAP_SECONDS * 1000)) {
        release(level);
        lastNote = now;
      }
      recent += (level - recent) * 0.2;

      const scale = Math.min(2, window.devicePixelRatio || 1);
      const [width, height] = [Math.round(innerWidth * scale), Math.round(innerHeight * scale)];
      if (el.width !== width || el.height !== height) {
        el.width = width;
        el.height = height;
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = notes.length - 1; i >= 0; i--) {
        const note = notes[i];
        note.age += seconds;
        if (note.age >= note.life) {
          notes.splice(i, 1);
          continue;
        }
        const heading = note.angle + Math.sin(note.age * 0.9 + note.wobble) * WOBBLE_RADIANS;
        note.x += Math.cos(heading) * note.speed * seconds;
        note.y += Math.sin(heading) * note.speed * seconds;
        ctx.globalAlpha = Math.min(1, note.age / FADE_IN_SECONDS, (note.life - note.age) / FADE_OUT_SECONDS);
        ctx.font = `${note.size}px serif`;
        ctx.fillText(note.glyph, note.x, note.y);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      theme.removeEventListener('change', applyTheme);
    };
  }, []);

  return (
    <div className="equalizer-bg" aria-hidden>
      <canvas ref={canvas} />
    </div>
  );
}
