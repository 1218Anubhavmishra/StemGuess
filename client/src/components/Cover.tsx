import { useEffect, useRef, useState } from 'react';
import { alignLevelsToSpeakers, readPeaks, stemPlayer } from '../audio';
import type { Credit } from '../types';

/** The YouTube video id in a watch, youtu.be, shorts or embed link. */
function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    return u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed)\/([\w-]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** A song's cover: the thumbnail of the YouTube video it links to (every hits song links to one). */
export function coverUrl(credit?: Credit | null): string | null {
  const id = credit?.url ? youtubeId(credit.url) : null;
  // mqdefault is 16:9 without letterbox bars, so a square crop of it shows the picture.
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
}

/**
 * A square cover tile. `hidden` shows the game's icon in an empty frame instead (a game round, before the
 * reveal, so the cover doesn't give it away); a song without a cover, or one that fails to load, shows the logo.
 */
export default function Cover({
  credit,
  hidden = false,
  lazy = false,
}: {
  credit?: Credit | null;
  hidden?: boolean;
  /** Load the picture only when it scrolls into view (long lists). */
  lazy?: boolean;
}) {
  const url = coverUrl(credit);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (hidden) {
    return (
      <span className="cover cover-hidden" role="img" aria-label="Cover hidden until you answer">
        <img src="/logo-mark.svg" alt="" />
      </span>
    );
  }
  if (!url || failed) {
    return (
      <span className="cover cover-none" aria-hidden>
        <img src="/logo-mark.svg" alt="" />
      </span>
    );
  }
  return (
    <img
      className="cover"
      src={url}
      alt="Song cover"
      loading={lazy ? 'lazy' : undefined}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * The song's cover, blurred, filling its box behind the content (with a pale wash so text stays readable).
 * The box needs the `has-backdrop` class. Renders nothing for a song without a cover.
 */
export function CoverBackdrop({ credit }: { credit?: Credit | null }) {
  const url = coverUrl(credit);
  return url ? <div className="cover-backdrop" aria-hidden style={{ backgroundImage: `url(${url})` }} /> : null;
}

const RING_BARS = 48;
const RING_PIXELS = 190;
// Where the bars start (just outside the circular cover) and how long the loudest can grow.
const RING_INNER = 68;
const RING_REACH = 26;
const RING_TURN_PER_SECOND = 0.15;
const RING_RISE = 0.5;
const RING_FALL = 0.14;

/**
 * A circular song cover inside a radial equalizer of the song playing. The game's icon stands in for the cover
 * until `revealed`, so it doesn't give the song away; the real cover then fades in over it.
 */
export function RingedCover({ credit, revealed }: { credit?: Credit | null; revealed: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const scale = window.devicePixelRatio || 1;
    el.width = el.height = RING_PIXELS * scale;
    ctx.scale(scale, scale);
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.5;
    const applyTheme = () => {
      ctx.strokeStyle = getComputedStyle(el).color;
    };
    applyTheme();
    const theme = matchMedia('(prefers-color-scheme: dark)');
    theme.addEventListener('change', applyTheme);

    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const peaks = new Float32Array(RING_BARS);
    const shown = new Float32Array(RING_BARS);
    const middle = RING_PIXELS / 2;
    let frame = 0;
    const draw = (now: number) => {
      // Held back by the speakers' latency, so the bars move with what you hear.
      alignLevelsToSpeakers();
      if (stemPlayer.isPlaying() && !still) readPeaks(peaks);
      else peaks.fill(0);
      ctx.clearRect(0, 0, RING_PIXELS, RING_PIXELS);
      const turn = (now / 1000) * RING_TURN_PER_SECOND;
      for (let bar = 0; bar < RING_BARS; bar++) {
        const target = peaks[bar] ** 2;
        shown[bar] += (target - shown[bar]) * (target > shown[bar] ? RING_RISE : RING_FALL);
        const angle = (bar / RING_BARS) * Math.PI * 2 + turn;
        const outer = RING_INNER + 2 + shown[bar] * RING_REACH;
        ctx.globalAlpha = 0.45 + shown[bar] * 0.55;
        ctx.beginPath();
        ctx.moveTo(middle + Math.cos(angle) * RING_INNER, middle + Math.sin(angle) * RING_INNER);
        ctx.lineTo(middle + Math.cos(angle) * outer, middle + Math.sin(angle) * outer);
        ctx.stroke();
      }
      if (!still) frame = requestAnimationFrame(draw);
    };
    draw(0);
    return () => {
      cancelAnimationFrame(frame);
      theme.removeEventListener('change', applyTheme);
    };
  }, []);

  return (
    <div className="ringed-cover">
      <canvas ref={canvas} aria-hidden />
      <Cover hidden />
      {revealed && <Cover credit={credit} />}
    </div>
  );
}
