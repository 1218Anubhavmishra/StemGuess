import { useState } from 'react';

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API needs a secure context; plain-http LAN addresses fall back to execCommand.
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

/** The room code, followed by its copy button. */
export default function Invite({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="room-code-row">
      <span className="muted small">Room code</span>
      <h1 className="room-code">{code}</h1>
      <button
        type="button"
        className="small"
        onClick={async () => {
          await copyText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'Copied!' : 'Copy room code'}
      </button>
    </div>
  );
}
