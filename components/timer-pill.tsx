'use client';

import { useEffect, useState } from 'react';
import { stopTimer } from '@/lib/actions/time';

function elapsed(since: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function TimerPill({ startedAt, label }: { startedAt: string; label: string }) {
  const [now, setNow] = useState(() => elapsed(startedAt));
  useEffect(() => {
    const id = setInterval(() => setNow(elapsed(startedAt)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <form action={stopTimer} className="flex items-center gap-2 rounded-full border border-coral-400/40 bg-coral-500/10 py-1 pl-3 pr-1">
      <span className="h-2 w-2 animate-pulse rounded-full bg-coral-500" />
      <span className="max-w-[180px] truncate text-xs font-medium text-ink">{label}</span>
      <span className="font-mono text-xs tabular-nums text-zinc-600">{now}</span>
      <button className="rounded-full bg-coral-500 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-coral-400">Stop</button>
    </form>
  );
}
