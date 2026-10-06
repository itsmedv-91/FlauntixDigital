'use client';

import Link from 'next/link';
import { useOptimistic, useState, useTransition } from 'react';
import { rescheduleContent } from '@/lib/actions/content';
import { CONTENT_STATUSES } from '@/lib/constants';
import type { ContentFormat, ContentStatus } from '@/lib/types';
import { cn, todayIST } from '@/lib/utils';

export interface CalendarItem {
  id: string;
  title: string;
  status: ContentStatus;
  format: ContentFormat;
  platforms: string[] | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  client?: { id: string; name: string } | null;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** All date maths is on plain YYYY-MM-DD strings in UTC, so IST never shifts a cell. */
function monthGrid(month: string): { date: string; inMonth: boolean }[] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - lead);

  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cellCount = Math.ceil((lead + daysInMonth) / 7) * 7;

  const cells: { date: string; inMonth: boolean }[] = [];
  for (let i = 0; i < cellCount; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    cells.push({ date: d.toISOString().slice(0, 10), inMonth: d.getUTCMonth() === m - 1 });
  }
  return cells;
}

function hhmm(t: string | null) {
  return t ? t.slice(0, 5) : null;
}

/** A stable colour per client, so a month of posts reads at a glance. */
function clientHue(name: string | undefined) {
  if (!name) return 250;
  return [...name].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
}

function Chip({ item, dragging, onDragStart, onDragEnd, canDrag }: {
  item: CalendarItem;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  canDrag: boolean;
}) {
  const tone = CONTENT_STATUSES.find((s) => s.value === item.status);
  const time = hhmm(item.scheduled_time);
  return (
    <div
      draggable={canDrag}
      onDragStart={(e) => {
        onDragStart();
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={onDragEnd}
      style={{ borderLeftColor: `hsl(${clientHue(item.client?.name)} 60% 55%)` }}
      className={cn(
        'rounded-md border border-zinc-200/70 border-l-[3px] bg-white px-1.5 py-1 shadow-sm transition',
        canDrag && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-40',
      )}
    >
      <Link href={`/content/${item.id}`} className="block">
        <span className="flex items-center gap-1">
          {time && <span className="shrink-0 text-[10px] font-medium tabular-nums text-zinc-400">{time}</span>}
          <span className="truncate text-[11px] font-medium leading-tight text-ink">{item.title}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-1">
          <span className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', tone?.tone.split(' ')[0] ?? 'bg-zinc-200')} />
          <span className="truncate text-[10px] text-zinc-500">
            {item.client?.name ?? 'No client'}
            {item.platforms?.length ? ` · ${item.platforms[0]}${item.platforms.length > 1 ? ` +${item.platforms.length - 1}` : ''}` : ''}
          </span>
        </span>
      </Link>
    </div>
  );
}

export function ContentCalendar({
  month,
  items,
  canDrag = true,
}: {
  month: string;
  items: CalendarItem[];
  canDrag?: boolean;
}) {
  const [optimistic, applyMove] = useOptimistic(items, (state: CalendarItem[], m: { id: string; date: string }) =>
    state.map((i) => (i.id === m.id ? { ...i, scheduled_date: m.date } : i)),
  );
  const [, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDate, setOverDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cells = monthGrid(month);
  const today = todayIST();
  const unscheduled = optimistic.filter((i) => !i.scheduled_date);
  const byDate = new Map<string, CalendarItem[]>();
  for (const i of optimistic) {
    if (!i.scheduled_date) continue;
    const list = byDate.get(i.scheduled_date) ?? [];
    list.push(i);
    byDate.set(i.scheduled_date, list);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => (a.scheduled_time ?? '99').localeCompare(b.scheduled_time ?? '99'));
  }

  function drop(date: string) {
    const id = dragId;
    setDragId(null);
    setOverDate(null);
    if (!id) return;
    if (optimistic.find((i) => i.id === id)?.scheduled_date === date) return;

    startTransition(async () => {
      applyMove({ id, date });
      const res = await rescheduleContent(id, date);
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

      {unscheduled.length > 0 && (
        <div className="mb-4 rounded-xl border border-dashed border-zinc-300 bg-white/60 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Unscheduled · {unscheduled.length}
            <span className="ml-2 font-normal normal-case tracking-normal text-zinc-400">drag onto a day to schedule</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {unscheduled.map((i) => (
              <div key={i.id} className="w-48">
                <Chip
                  item={i}
                  canDrag={canDrag}
                  dragging={dragId === i.id}
                  onDragStart={() => setDragId(i.id)}
                  onDragEnd={() => setDragId(null)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white shadow-card">
        <div className="grid grid-cols-7 border-b border-zinc-100 bg-zinc-50/80">
          {DAY_LABELS.map((d) => (
            <div key={d} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              <span className="hidden sm:inline">{d}</span>
              <span className="sm:hidden">{d[0]}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell) => {
            const dayItems = byDate.get(cell.date) ?? [];
            const isToday = cell.date === today;
            return (
              <div
                key={cell.date}
                onDragOver={(e) => {
                  if (!canDrag) return;
                  e.preventDefault();
                  setOverDate(cell.date);
                }}
                onDragLeave={() => setOverDate((d) => (d === cell.date ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(cell.date);
                }}
                className={cn(
                  'min-h-[108px] border-b border-r border-zinc-100 p-1.5 transition-colors last:border-r-0',
                  !cell.inMonth && 'bg-zinc-50/60',
                  overDate === cell.date && 'bg-brand-50 ring-2 ring-inset ring-brand-200',
                )}
              >
                <div className="mb-1 flex items-center justify-between px-0.5">
                  <span
                    className={cn(
                      'text-[11px] font-medium',
                      isToday
                        ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink text-white'
                        : cell.inMonth
                          ? 'text-zinc-600'
                          : 'text-zinc-300',
                    )}
                  >
                    {Number(cell.date.slice(8, 10))}
                  </span>
                  {dayItems.length > 2 && <span className="text-[10px] text-zinc-400">{dayItems.length}</span>}
                </div>
                <div className="space-y-1">
                  {dayItems.map((i) => (
                    <Chip
                      key={i.id}
                      item={i}
                      canDrag={canDrag}
                      dragging={dragId === i.id}
                      onDragStart={() => setDragId(i.id)}
                      onDragEnd={() => setDragId(null)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
