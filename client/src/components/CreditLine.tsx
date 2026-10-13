import type { Credit } from '../types';

export default function CreditLine({ credit }: { credit: Credit }) {
  return (
    <p className="credit muted small">
      {credit.url ? (
        <a href={credit.url} target="_blank" rel="noreferrer">
          {credit.text}
        </a>
      ) : (
        credit.text
      )}
      {credit.license && (
        <>
          {' · Licensed under '}
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
