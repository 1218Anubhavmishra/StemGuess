import type { Credit } from '../types';

const SITES: [domain: string, name: string][] = [
  ['youtube.com', 'YouTube'],
  ['youtu.be', 'YouTube'],
  ['music.apple.com', 'Apple Music'],
  ['incompetech.com', 'Incompetech'],
  ['ccmixter.org', 'ccMixter'],
  ['audiomack.com', 'Audiomack'],
  ['bugs.co.kr', 'Bugs'],
];

/** The site a credit link points to, e.g. "YouTube". */
export function sourceName(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return 'source';
  }
  const site = SITES.find(([domain]) => host === domain || host.endsWith(`.${domain}`));
  return site ? site[1] : host.replace(/^www\./, '');
}

/** "Listen on <site>". Creative Commons songs also keep their licence; their title and artist are shown beside it. */
export default function CreditLine({ credit }: { credit: Credit }) {
  if (!credit.url && !credit.license) return null;
  return (
    <p className="credit muted small">
      {credit.url && (
        <a href={credit.url} target="_blank" rel="noreferrer">
          Listen on {sourceName(credit.url)}
        </a>
      )}
      {credit.license && (
        <>
          {credit.url && ' · '}
          {/excerpt/i.test(credit.text) ? 'Excerpt licensed under ' : 'Licensed under '}
          {credit.licenseUrl ? (
            <a href={credit.licenseUrl} target="_blank" rel="noreferrer">
              {credit.license}
            </a>
          ) : (
            credit.license
          )}
        </>
      )}
    </p>
  );
}
