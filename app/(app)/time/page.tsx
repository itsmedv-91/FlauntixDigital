import Link from 'next/link';
import { getContext, getTeam } from '@/lib/auth';
import { addManualEntry, deleteTimeEntry, startTimer } from '@/lib/actions/time';
import { SubmitButton } from '@/components/submit-button';
import { TimerPill } from '@/components/timer-pill';
import { Card, CardHeader, Disclosure, EmptyState, Field, Input, PageHeader, Select, Stat, Textarea } from '@/components/ui';
import { addDays, cn, displayName, formatDate, formatMinutes, todayIST, weekStartIST } from '@/lib/utils';

export const metadata = { title: 'Time' };

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface EntryRow {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  minutes: number | null;
  note: string | null;
  billable: boolean;
  task: { id: string; title: string } | null;
  project: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
}

/** The IST calendar day (YYYY-MM-DD) an entry belongs to. */
function dayOf(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}

export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; team?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await getContext();

  const offset = Math.max(-52, Math.min(0, Number(sp.week) || 0));
  const weekStart = weekStartIST(offset);
  const weekEnd = addDays(weekStart, 7);
  const days = DAY_LABELS.map((label, i) => ({ label, date: addDays(weekStart, i) }));
  const showTeam = ctx.isManager && sp.team === '1';

  let q = ctx.supabase
    .from('time_entries')
    .select(
      'id, user_id, started_at, ended_at, minutes, note, billable, task:tasks(id, title), project:projects(id, name), client:clients(id, name)',
    )
    .eq('agency_id', ctx.agencyId)
    .gte('started_at', `${weekStart}T00:00:00+05:30`)
    .lt('started_at', `${weekEnd}T00:00:00+05:30`)
    .order('started_at', { ascending: false });
  if (!showTeam) q = q.eq('user_id', ctx.user.id);

  const [{ data: entryRows }, { data: taskRows }, { data: projectRows }, team, { data: running }] = await Promise.all([
    q.limit(500),
    ctx.supabase
      .from('tasks')
      .select('id, title, client:clients(name)')
      .eq('agency_id', ctx.agencyId)
      .neq('status', 'done')
      .order('position')
      .limit(200),
    ctx.supabase.from('projects').select('id, name').eq('agency_id', ctx.agencyId).in('status', ['planning', 'active', 'on_hold']).order('name'),
    getTeam(),
    ctx.supabase
      .from('time_entries')
      .select('id, started_at, note, task:tasks(title)')
      .eq('user_id', ctx.user.id)
      .is('ended_at', null)
      .maybeSingle(),
  ]);

  const entries = (entryRows ?? []) as unknown as EntryRow[];
  const tasks = (taskRows ?? []) as unknown as { id: string; title: string; client: { name: string } | null }[];
  const names = new Map(team.map((m) => [m.user_id, displayName(m.profile)]));
  const runningTask = running?.task as unknown as { title: string } | null;

  const total = entries.reduce((s, e) => s + (e.minutes ?? 0), 0);
  const billable = entries.filter((e) => e.billable).reduce((s, e) => s + (e.minutes ?? 0), 0);

  const perDay = new Map(days.map((d) => [d.date, 0]));
  const perClient = new Map<string, number>();
  const perPerson = new Map<string, { total: number; billable: number }>();
  for (const e of entries) {
    const mins = e.minutes ?? 0;
    const day = dayOf(e.started_at);
    if (perDay.has(day)) perDay.set(day, (perDay.get(day) ?? 0) + mins);
    const client = e.client?.name ?? 'Internal / no client';
    perClient.set(client, (perClient.get(client) ?? 0) + mins);
    const p = perPerson.get(e.user_id) ?? { total: 0, billable: 0 };
    p.total += mins;
    if (e.billable) p.billable += mins;
    perPerson.set(e.user_id, p);
  }
  const maxDay = Math.max(60, ...perDay.values());
  const today = todayIST();

  const weekLink = (patch: { week?: number; team?: string }) => {
    const next = new URLSearchParams();
    const w = patch.week ?? offset;
    if (w) next.set('week', String(w));
    const t = patch.team ?? (showTeam ? '1' : '');
    if (t) next.set('team', t);
    const qs = next.toString();
    return qs ? `/time?${qs}` : '/time';
  };

  const byDay = days.map((d) => ({ ...d, items: entries.filter((e) => dayOf(e.started_at) === d.date) }));

  return (
    <>
      <PageHeader
        title="Time"
        subtitle={`${formatDate(weekStart, true)} – ${formatDate(addDays(weekStart, 6), true)}${showTeam ? ' · whole team' : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {ctx.isManager && (
              <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5 text-sm">
                <Link
                  href={weekLink({ team: '' })}
                  className={cn('rounded-md px-3 py-1.5 font-medium', !showTeam ? 'bg-ink text-white' : 'text-zinc-600 hover:text-ink')}
                >
                  Me
                </Link>
                <Link
                  href={weekLink({ team: '1' })}
                  className={cn('rounded-md px-3 py-1.5 font-medium', showTeam ? 'bg-ink text-white' : 'text-zinc-600 hover:text-ink')}
                >
                  Team
                </Link>
              </div>
            )}
            <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white p-0.5 text-sm">
              <Link href={weekLink({ week: offset - 1 })} className="rounded-md px-2.5 py-1.5 text-zinc-600 hover:text-ink" aria-label="Previous week">
                ←
              </Link>
              <Link href={weekLink({ week: 0 })} className={cn('rounded-md px-2.5 py-1.5 font-medium', offset === 0 ? 'bg-ink text-white' : 'text-zinc-600 hover:text-ink')}>
                This week
              </Link>
              <Link
                href={weekLink({ week: offset + 1 })}
                className={cn('rounded-md px-2.5 py-1.5', offset < 0 ? 'text-zinc-600 hover:text-ink' : 'pointer-events-none text-zinc-300')}
                aria-label="Next week"
              >
                →
              </Link>
            </div>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={showTeam ? 'Team hours' : 'Your hours'} value={formatMinutes(total)} hint="This week" />
        <Stat label="Billable" value={formatMinutes(billable)} hint={total ? `${Math.round((billable / total) * 100)}% of logged time` : undefined} />
        <Stat label="Non-billable" value={formatMinutes(total - billable)} />
        <Stat label="Entries" value={entries.length} />
      </div>

      {!showTeam && (
        <div className="mb-5 space-y-3">
          {running ? (
            <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-ink">Timer running</p>
                <p className="text-xs text-zinc-500">{runningTask?.title ?? running.note ?? 'Untitled'}</p>
              </div>
              <TimerPill startedAt={running.started_at} label={runningTask?.title ?? running.note ?? 'Timer running'} />
            </Card>
          ) : (
            <Card>
              <CardHeader title="Start a timer" subtitle="Starting a timer stops any timer already running." />
              <form action={startTimer} className="grid gap-3 px-5 py-4 sm:grid-cols-[2fr,2fr,auto] sm:items-end">
                <Field label="Task">
                  <Select name="task_id">
                    <option value="">No task</option>
                    {tasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.client?.name ? `${t.client.name} — ` : ''}
                        {t.title}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="What are you working on?">
                  <Input name="note" placeholder="Optional note" />
                </Field>
                <SubmitButton pendingText="Starting…">Start timer</SubmitButton>
              </form>
            </Card>
          )}

          <Disclosure summary="Log time manually">
            <form action={addManualEntry} className="grid gap-4 sm:grid-cols-2">
              <Field label="Date">
                <Input name="date" type="date" required defaultValue={offset === 0 ? today : weekStart} max={today} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Hours">
                  <Input name="hours" type="number" min="0" max="24" step="1" placeholder="1" />
                </Field>
                <Field label="Minutes">
                  <Input name="minutes" type="number" min="0" max="59" step="5" placeholder="30" />
                </Field>
              </div>
              <Field label="Task">
                <Select name="task_id">
                  <option value="">No task</option>
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.client?.name ? `${t.client.name} — ` : ''}
                      {t.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Project" hint="Used only when no task is picked">
                <Select name="project_id">
                  <option value="">No project</option>
                  {(projectRows ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Note" className="sm:col-span-2">
                <Textarea name="note" rows={2} placeholder="What did you do?" />
              </Field>
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input type="checkbox" name="billable" defaultChecked /> Billable to the client
              </label>
              <div className="sm:col-span-2">
                <SubmitButton>Add entry</SubmitButton>
              </div>
            </form>
          </Disclosure>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="This week, day by day" subtitle={showTeam ? 'Everyone in the agency' : 'Your entries'} />
          <div className="space-y-1 px-5 py-4">
            {days.map((d) => {
              const mins = perDay.get(d.date) ?? 0;
              return (
                <div key={d.date} className="flex items-center gap-3">
                  <span className={cn('w-20 shrink-0 text-xs', d.date === today ? 'font-semibold text-ink' : 'text-zinc-500')}>
                    {d.label} {formatDate(d.date)}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100">
                    <div className="h-full rounded-full bg-brand-400" style={{ width: `${Math.round((mins / maxDay) * 100)}%` }} />
                  </div>
                  <span className="w-16 shrink-0 text-right text-xs tabular-nums text-zinc-600">{mins ? formatMinutes(mins) : '—'}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader title="Hours per client" />
          {perClient.size === 0 ? (
            <p className="px-5 py-4 text-sm text-zinc-500">Nothing logged this week.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {[...perClient.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, mins]) => (
                  <li key={name} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="truncate text-zinc-700">{name}</span>
                    <span className="shrink-0 tabular-nums text-zinc-500">{formatMinutes(mins)}</span>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>

      {showTeam && (
        <Card className="mt-5 overflow-x-auto">
          <CardHeader title="Team hours this week" subtitle="Billable vs non-billable" />
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500">
                <th className="px-5 py-3 font-medium">Member</th>
                <th className="px-3 py-3 font-medium">Total</th>
                <th className="px-3 py-3 font-medium">Billable</th>
                <th className="px-5 py-3 font-medium">Non-billable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {team.map((m) => {
                const p = perPerson.get(m.user_id) ?? { total: 0, billable: 0 };
                return (
                  <tr key={m.user_id} className="hover:bg-zinc-50">
                    <td className="px-5 py-3 font-medium text-ink">{displayName(m.profile)}</td>
                    <td className="px-3 py-3 tabular-nums">{p.total ? formatMinutes(p.total) : '—'}</td>
                    <td className="px-3 py-3 tabular-nums text-emerald-700">{p.billable ? formatMinutes(p.billable) : '—'}</td>
                    <td className="px-5 py-3 tabular-nums text-zinc-500">{p.total - p.billable ? formatMinutes(p.total - p.billable) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <div className="mt-5">
        {entries.length === 0 ? (
          <EmptyState title="No time logged this week" body="Start a timer or add an entry manually to see it here." />
        ) : (
          <Card className="divide-y divide-zinc-100">
            <CardHeader title="Entries" subtitle={`${entries.length} this week`} />
            {byDay
              .filter((d) => d.items.length > 0)
              .reverse()
              .map((d) => (
                <div key={d.date}>
                  <p className="bg-zinc-50/80 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {d.label} {formatDate(d.date, true)} · {formatMinutes(d.items.reduce((s, e) => s + (e.minutes ?? 0), 0))}
                  </p>
                  <ul className="divide-y divide-zinc-100">
                    {d.items.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                        <span className="w-16 shrink-0 font-medium tabular-nums text-ink">
                          {e.ended_at ? formatMinutes(e.minutes) : 'running'}
                        </span>
                        <span className="min-w-0 flex-1">
                          {e.task ? (
                            <Link href={`/tasks/${e.task.id}`} className="font-medium text-ink hover:text-brand-600">
                              {e.task.title}
                            </Link>
                          ) : (
                            <span className="font-medium text-ink">{e.note ?? 'Untitled entry'}</span>
                          )}
                          <span className="block truncate text-xs text-zinc-500">
                            {[showTeam ? names.get(e.user_id) : null, e.client?.name, e.project?.name, e.task && e.note]
                              .filter(Boolean)
                              .join(' · ') || '—'}
                          </span>
                        </span>
                        {!e.billable && <span className="shrink-0 text-xs text-zinc-400">non-billable</span>}
                        {(e.user_id === ctx.user.id || ctx.isManager) && (
                          <form action={deleteTimeEntry.bind(null, e.id)} className="shrink-0">
                            <SubmitButton variant="ghost" size="sm" confirm="Delete this time entry?" pendingText="…">
                              Delete
                            </SubmitButton>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </Card>
        )}
      </div>
    </>
  );
}
