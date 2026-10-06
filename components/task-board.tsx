'use client';

import Link from 'next/link';
import { useOptimistic, useState, useTransition } from 'react';
import { moveTask } from '@/lib/actions/tasks';
import { TASK_STATUSES } from '@/lib/constants';
import type { TaskStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { DueDate, PriorityBadge, type TaskListItem } from './task-bits';
import { Avatar } from './ui';

export type BoardTask = TaskListItem & { position: number; revision_count?: number };

type Move = { id: string; status: TaskStatus; position: number };

export function TaskBoard({ tasks, canDrag = true }: { tasks: BoardTask[]; canDrag?: boolean }) {
  const [optimistic, applyMove] = useOptimistic(tasks, (state: BoardTask[], m: Move) =>
    state.map((t) => (t.id === m.id ? { ...t, status: m.status, position: m.position } : t)),
  );
  const [, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const columns = TASK_STATUSES.map((s) => ({
    ...s,
    items: optimistic.filter((t) => t.status === s.value).sort((a, b) => a.position - b.position),
  }));

  function drop(status: TaskStatus, beforeId?: string) {
    const id = dragId;
    setDragId(null);
    setOverCol(null);
    if (!id) return;
    const col = columns.find((c) => c.value === status)!.items.filter((t) => t.id !== id);
    let position: number;
    if (beforeId) {
      const idx = col.findIndex((t) => t.id === beforeId);
      const next = col[idx]?.position ?? Date.now();
      const prev = idx > 0 ? col[idx - 1].position : next - 1000;
      position = (prev + next) / 2;
    } else {
      position = (col.at(-1)?.position ?? 0) + 1000;
    }
    const current = optimistic.find((t) => t.id === id);
    if (current && current.status === status && current.position === position) return;

    startTransition(async () => {
      applyMove({ id, status, position });
      const res = await moveTask(id, status, position);
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
              'flex w-72 shrink-0 flex-col rounded-xl bg-zinc-100/70 p-2 transition-colors',
              overCol === col.value && 'bg-brand-50 ring-2 ring-brand-200',
            )}
          >
            <header className="flex items-center justify-between px-2 pb-2 pt-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{col.label}</h3>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-500">{col.items.length}</span>
            </header>
            <div className="flex min-h-[80px] flex-1 flex-col gap-2">
              {col.items.map((t) => (
                <article
                  key={t.id}
                  draggable={canDrag}
                  onDragStart={(e) => {
                    setDragId(t.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setDragId(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    drop(col.value, t.id);
                  }}
                  className={cn(
                    'group rounded-lg border border-zinc-200/80 bg-white p-3 shadow-card transition',
                    canDrag && 'cursor-grab active:cursor-grabbing',
                    dragId === t.id && 'opacity-40',
                  )}
                >
                  <Link href={`/tasks/${t.id}`} className="block text-sm font-medium leading-snug text-ink hover:text-brand-600">
                    {t.title}
                  </Link>
                  {(t.client || t.project) && (
                    <p className="mt-1 truncate text-[11px] text-zinc-500">
                      {[t.client?.name, t.project?.name].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <PriorityBadge priority={t.priority} />
                      {!!t.revision_count && (
                        <span className="text-[11px] text-zinc-400" title="Revisions">
                          R{t.revision_count}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <DueDate date={t.due_date} status={t.status} />
                      {t.assignee && <Avatar person={t.assignee} size="sm" />}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
