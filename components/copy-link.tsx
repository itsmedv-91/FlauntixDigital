'use client';

import { useState } from 'react';

/** Shows an invite link with a one-click copy button (no email sending yet). */
export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <code className="min-w-0 flex-1 truncate rounded-md bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600">{url}</code>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            setCopied(false);
          }
        }}
        className="shrink-0 text-xs font-medium text-brand-600 hover:underline"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}
