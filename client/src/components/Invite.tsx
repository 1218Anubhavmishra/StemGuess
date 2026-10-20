import { useEffect, useState } from 'react';
import { SERVER_URL, serverUrl } from '../socket';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

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

export default function Invite({ code }: { code: string }) {
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void shareableBase().then((base) => {
      if (!cancelled) setLink(`${base}/?room=${code}`);
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (!link) return null;

  return (
    <button
      type="button"
      className="small invite"
      onClick={async () => {
        await copyText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? 'Copied!' : 'Copy invite link'}
    </button>
  );
}
