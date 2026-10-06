'use client';

import Link from 'next/link';
import { useOptimistic, useState, useTransition } from 'react';
import { moveLead } from '@/lib/actions/leads';
import { LEAD_STAGES } from '@/lib/constants';
import type { LeadStage, Profile } from '@/lib/types';
import { cn, formatDate, formatINR, isOverdue } from '@/lib/utils';
import { Avatar } from './ui';

export interface BoardLead {
  id: string;
  company: string;
  contact_name: string | null;
  source: string | null;
  estimated_value: number | null;
  next_follow_up: string | null;
  stage: LeadStage;
  owner?: Profile | null;
}

export function LeadBoard({ leads, canDrag = true }: { leads: BoardLead[]; canDrag?: boolean }) {
  const [optimistic, applyMove] = useOptimistic(leads, (state: BoardLead[], m: { id: string; stage: LeadStage }) =>
    state.map((l) => (l.id === m.id ? { ...l, stage: m.stage } : l)),
  );
  const [, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<LeadStage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const columns = LEAD_STAGES.map((s) => {
    const items = optimistic.filter((l) => l.stage === s.value);
    return { ...s, items, total: items.reduce((sum, l) => sum + (l.estimated_value ?? 0), 0) };
  });

  function drop(stage: LeadStage) {
    const id = dragId;
    setDragId(null);
    setOverCol(null);
    if (!id) return;
    if (optimistic.find((l) => l.id === id)?.stage === stage) return;

    startTransition(async () => {
      applyMove({ id, stage });
      const res = await moveLead(id, stage);
      if (res && 'error' in res && res.error) setError(res.error);
    });
  }

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error} <button className="ml-2 underline" onClick={() => setError(null)}>Dismiss</button>
        </p>
      )}
      <div className="scrollbar-thin -mx-4 flex gap-4 overflow-x-auto px-4 pb-4 sm:-mx-8 sm:px-8">
        {columns.map((col) => (
          <section
            key={col.value}
            onDragOver={(e) => {
              if (!canDrag) return;
              e.preventDefault();
              setOverCol(col.value);
            }}
            onDragLeave={() => setOverCol((c) => (c === col.value ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              drop(col.value);
            }}
            className={cn(
              'flex w-64 shrink-0 flex-col rounded-xl bg-zinc-100/70 p-2 transition-colors',
              overCol === col.value && 'bg-brand-50 ring-2 ring-brand-200',
            )}
          >
            <header className="px-2 pb-2 pt-1">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{col.label}</h3>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-500">{col.items.length}</span>
              </div>
              <p className="mt-0.5 text-[11px] tabular-nums text-zinc-400">{col.total ? formatINR(col.total) : '—'}</p>
            </header>
            <div className="flex min-h-[80px] flex-1 flex-col gap-2">
              {col.items.map((l) => {
                const chase = isOverdue(l.next_follow_up) && l.stage !== 'won' && l.stage !== 'lost';
                return (
                  <article
                    key={l.id}
                    draggable={canDrag}
                    onDragStart={(e) => {
                      setDragId(l.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => setDragId(null)}
                    className={cn(
                      'rounded-lg border bg-white p-3 shadow-card transition',
                      chase ? 'border-coral-500/40' : 'border-zinc-200/80',
                      canDrag && 'cursor-grab active:cursor-grabbing',
                      dragId === l.id && 'opacity-40',
                    )}
                  >
                    <Link href={`/leads/${l.id}`} className="block text-sm font-medium leading-snug text-ink hover:text-brand-600">
                      {l.company}
                    </Link>
                    {(l.contact_name || l.source) && (
                      <p className="mt-1 truncate text-[11px] text-zinc-500">
                        {[l.contact_name, l.source].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium tabular-nums text-zinc-600">{formatINR(l.estimated_value)}</span>
                      <div className="flex items-center gap-2">
                        {l.next_follow_up && (
                          <span className={cn('text-[11px]', chase ? 'font-semibold text-coral-500' : 'text-zinc-500')}>
                            {chase ? 'Chase · ' : ''}
                            {formatDate(l.next_follow_up)}
                          </span>
                        )}
                        {l.owner && <Avatar person={l.owner} size="sm" />}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
