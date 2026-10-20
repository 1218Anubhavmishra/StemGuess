import { useEffect, useState } from 'react';
import { SERVER_URL, serverUrl } from '../socket';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const PRIVATE_IP = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** Base URL other devices can open. A localhost address is swapped for this machine's LAN IP. */
async function shareableBase(): Promise<string> {
  const url = new URL(SERVER_URL);
  if (LOCAL_HOSTS.includes(url.hostname)) {
    try {
      const { ip } = await (await fetch(serverUrl('/lan'))).json();
      if (ip) url.hostname = ip;
    } catch {
      // Keep the localhost link; it still works on this machine.
    }
  }
  return url.origin;
}

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

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="small"
      onClick={async () => {
        await copyText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? 'Copied!' : label}
    </button>
  );
}

export default function Invite({ code }: { code: string }) {
  const [base, setBase] = useState('');

  useEffect(() => {
    let cancelled = false;
    void shareableBase().then((found) => {
      if (!cancelled) setBase(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A server on this Wi-Fi only knows its own rooms: friends must open its address, not the public site.
  const lan = base ? new URL(base) : null;
  const onLan = lan !== null && (PRIVATE_IP.test(lan.hostname) || LOCAL_HOSTS.includes(lan.hostname));

  return (
    <>
      <div className="invite">
        {base && <CopyButton text={`${base}/?room=${code}`} label="Copy invite link" />}
        <CopyButton text={code} label="Copy room code" />
      </div>
      {onLan && (
        <p className="muted small">
          This room is on this computer. Friends on the same Wi-Fi open <b>{lan.host}</b> in their browser, then
          enter the code.
        </p>
      )}
    </>
  );
}
