'use client';

import Link from 'next/link';
import { useOptimistic, useState, useTransition } from 'react';
import { moveContent } from '@/lib/actions/content';
import { CONTENT_FORMATS, CONTENT_STATUSES } from '@/lib/constants';
import type { ContentStatus } from '@/lib/types';
import { cn, formatDate, isOverdue } from '@/lib/utils';
import { Avatar } from './ui';
import type { CalendarItem } from './content-calendar';

export type BoardContent = CalendarItem & {
  revision_count?: number;
  max_revisions?: number | null;
  assignee?: { full_name: string | null; email: string | null } | null;
};

const COLUMNS = CONTENT_STATUSES.filter((s) => s.board);

export function ContentBoard({ items, canDrag = true }: { items: BoardContent[]; canDrag?: boolean }) {
  const [optimistic, applyMove] = useOptimistic(items, (state: BoardContent[], m: { id: string; status: ContentStatus }) =>
    state.map((i) => (i.id === m.id ? { ...i, status: m.status } : i)),
  );
  const [, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<ContentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  function drop(status: ContentStatus) {
    const id = dragId;
    setDragId(null);
    setOverCol(null);
    if (!id) return;
    if (optimistic.find((i) => i.id === id)?.status === status) return;

    startTransition(async () => {
      applyMove({ id, status });
      const res = await moveContent(id, status);
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
      <p className="mb-2 text-xs text-zinc-500">
        Dropping a card into <span className="font-medium text-ink">With client</span> sends it for approval and opens a new round.
      </p>
      <div className="scrollbar-thin -mx-4 flex gap-4 overflow-x-auto px-4 pb-4 sm:-mx-8 sm:px-8">
        {COLUMNS.map((col) => {
          const colItems = optimistic.filter((i) => i.status === col.value);
          return (
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
              <header className="flex items-center justify-between px-2 pb-2 pt-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{col.label}</h3>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-500">{colItems.length}</span>
              </header>
              <div className="flex min-h-[80px] flex-1 flex-col gap-2">
                {colItems.map((i) => {
                  const overRevisions = i.max_revisions != null && (i.revision_count ?? 0) > i.max_revisions;
                  const late = isOverdue(i.scheduled_date) && i.status !== 'published';
                  return (
                    <article
                      key={i.id}
                      draggable={canDrag}
                      onDragStart={(e) => {
                        setDragId(i.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => setDragId(null)}
                      className={cn(
                        'rounded-lg border border-zinc-200/80 bg-white p-3 shadow-card transition',
                        canDrag && 'cursor-grab active:cursor-grabbing',
                        dragId === i.id && 'opacity-40',
                      )}
                    >
                      <Link href={`/content/${i.id}`} className="block text-sm font-medium leading-snug text-ink hover:text-brand-600">
                        {i.title}
                      </Link>
                      <p className="mt-1 truncate text-[11px] text-zinc-500">
                        {[i.client?.name, CONTENT_FORMATS.find((f) => f.value === i.format)?.label].filter(Boolean).join(' · ')}
                      </p>
                      <div className="mt-2.5 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          {!!i.revision_count && (
                            <span
                              className={cn('text-[11px]', overRevisions ? 'font-semibold text-coral-500' : 'text-zinc-400')}
                              title={i.max_revisions != null ? `${i.revision_count} of ${i.max_revisions} revisions used` : 'Revisions'}
                            >
                              R{i.revision_count}
                              {i.max_revisions != null ? `/${i.max_revisions}` : ''}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={cn('text-[11px]', late ? 'font-semibold text-coral-500' : 'text-zinc-500')}>
                            {i.scheduled_date ? formatDate(i.scheduled_date) : 'No date'}
                          </span>
                          {i.assignee && <Avatar person={i.assignee} size="sm" />}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
