import { useEffect, useState } from 'react';
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
 * A square cover tile. `hidden` shows a "?" instead (Practice, before the answer, so the cover
 * doesn't give it away); a song without a cover, or one that fails to load, shows the logo.
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
      <span className="cover cover-hidden" aria-label="Cover hidden until you answer">
        ?
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
