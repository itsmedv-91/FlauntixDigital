'use client';

import { useEffect, useState, useTransition } from 'react';
import { revealCredential } from '@/lib/actions/vault';

export function RevealSecret({ id }: { id: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  // Hide again after 30 seconds.
  useEffect(() => {
    if (!secret) return;
    const t = setTimeout(() => setSecret(null), 30_000);
    return () => clearTimeout(t);
  }, [secret]);

  if (error) return <span className="text-xs text-red-600">{error}</span>;

  if (!secret) {
    return (
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await revealCredential(id);
            if (res.error) setError(res.error);
            else setSecret(res.secret ?? '');
          })
        }
        className="rounded-md bg-zinc-100 px-2 py-1 font-mono text-xs text-zinc-500 hover:bg-zinc-200"
      >
        {pending ? 'Decrypting…' : '•••••••• Show'}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900 ring-1 ring-amber-200">{secret}</code>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(secret);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="text-xs font-medium text-brand-600 hover:underline"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button onClick={() => setSecret(null)} className="text-xs text-zinc-400 hover:text-ink">Hide</button>
    </span>
  );
}
