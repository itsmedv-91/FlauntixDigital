import Link from 'next/link';
import { getContext } from '@/lib/auth';
import { TASK_SELECT, TaskRow, type TaskListItem } from '@/components/task-bits';
import { Avatar, Card, CardHeader, EmptyState, LinkButton, PageHeader, Stat } from '@/components/ui';
import { displayName, formatDateTime, formatINR, formatMinutes, todayIST, weekStartIST } from '@/lib/utils';

export const metadata = { title: 'Dashboard' };

function describe(a: { entity_type: string; action: string; meta: Record<string, unknown> | null }) {
  const name = (a.meta?.title ?? a.meta?.name ?? a.meta?.company ?? a.meta?.email ?? '') as string;
  const extra = a.meta?.status ? ` → ${String(a.meta.status).replace('_', ' ')}` : a.meta?.stage ? ` → ${a.meta.stage}` : '';
  return `${a.action.replace('_', ' ')} ${a.entity_type}${name ? ` “${name}”` : ''}${extra}`;
}

export default async function DashboardPage() {
  const ctx = await getContext();
  const sb = ctx.supabase;
  const today = todayIST();
  const weekStart = weekStartIST();
  const firstName = (ctx.profile.full_name ?? '').split(' ')[0] || 'there';

  const [myTasks, overdue, approval, myWeek, clients, leads, activity, teamOpen] = await Promise.all([
    sb.from('tasks').select(TASK_SELECT).eq('agency_id', ctx.agencyId).eq('assignee_id', ctx.user.id).neq('status', 'done')
      .order('due_date', { ascending: true, nullsFirst: false }).limit(8),
    sb.from('tasks').select('id', { count: 'exact', head: true }).eq('agency_id', ctx.agencyId).eq('assignee_id', ctx.user.id)
      .neq('status', 'done').lt('due_date', today),
    sb.from('tasks').select(TASK_SELECT).eq('agency_id', ctx.agencyId).eq('status', 'client_approval')
      .order('updated_at', { ascending: true }).limit(6),
    sb.from('time_entries').select('minutes').eq('user_id', ctx.user.id).eq('agency_id', ctx.agencyId)
      .gte('started_at', `${weekStart}T00:00:00+05:30`),
    ctx.isStaff
      ? sb.from('clients').select('id', { count: 'exact', head: true }).eq('agency_id', ctx.agencyId).in('status', ['active', 'onboarding'])
      : Promise.resolve({ count: 0 }),
    ctx.isStaff
      ? sb.from('leads').select('estimated_value, stage').eq('agency_id', ctx.agencyId).not('stage', 'in', '(won,lost)')
      : Promise.resolve({ data: [] }),
    ctx.isStaff
      ? sb.from('activity_log').select('id, action, entity_type, entity_id, meta, created_at, actor:profiles(full_name, email)')
          .eq('agency_id', ctx.agencyId).order('created_at', { ascending: false }).limit(12)
      : Promise.resolve({ data: [] }),
    ctx.isManager
      ? sb.from('tasks').select('assignee_id, due_date, assignee:profiles!tasks_assignee_id_fkey(id, full_name, email)')
          .eq('agency_id', ctx.agencyId).neq('status', 'done').not('assignee_id', 'is', null)
      : Promise.resolve({ data: [] }),
  ]);

  const tasks = (myTasks.data ?? []) as unknown as TaskListItem[];
  const approvals = (approval.data ?? []) as unknown as TaskListItem[];
  const weekMinutes = (myWeek.data ?? []).reduce((s: number, e: { minutes: number | null }) => s + (e.minutes ?? 0), 0);
  const leadRows = (leads.data ?? []) as { estimated_value: number | null }[];
  const pipeline = leadRows.reduce((s, l) => s + (l.estimated_value ?? 0), 0);

  const workload = new Map<string, { person: { full_name: string | null; email: string | null }; open: number; overdue: number }>();
  for (const t of (teamOpen.data ?? []) as unknown as { assignee_id: string; due_date: string | null; assignee: { full_name: string | null; email: string | null } }[]) {
    const w = workload.get(t.assignee_id) ?? { person: t.assignee, open: 0, overdue: 0 };
    w.open += 1;
    if (t.due_date && t.due_date < today) w.overdue += 1;
    workload.set(t.assignee_id, w);
  }
  const maxOpen = Math.max(1, ...[...workload.values()].map((w) => w.open));

  return (
    <>
      <PageHeader
        title={`Hi ${firstName}`}
        subtitle={new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date())}
        actions={ctx.isStaff && <LinkButton href="/tasks?new=1">New task</LinkButton>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="My open tasks" value={tasks.length === 8 ? '8+' : tasks.length} />
        <Stat label="My overdue tasks" value={overdue.count ?? 0} tone={(overdue.count ?? 0) > 0 ? 'warn' : undefined} />
        {ctx.isStaff ? (
          <>
            <Stat label="Waiting on clients" value={approvals.length === 6 ? '6+' : approvals.length} hint="In client approval" />
            <Stat label="Active clients" value={clients.count ?? 0} hint={ctx.isManager ? `Pipeline ${formatINR(pipeline)}` : undefined} />
          </>
        ) : (
          <Stat label="Logged this week" value={formatMinutes(weekMinutes)} />
        )}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="My tasks"
              subtitle="Open, soonest due first"
              action={<Link href="/tasks?view=list&mine=1" className="text-xs font-medium text-brand-600 hover:underline">View all</Link>}
            />
            {tasks.length ? (
              <div className="divide-y divide-zinc-100">
                {tasks.map((t) => <TaskRow key={t.id} task={t} showAssignee={false} />)}
              </div>
            ) : (
              <div className="p-5"><EmptyState title="You're all clear" body="No open tasks assigned to you." /></div>
            )}
          </Card>

          {ctx.isStaff && (
            <Card>
              <CardHeader title="Waiting on client approval" subtitle="Oldest first, so you know whom to chase" />
              {approvals.length ? (
                <div className="divide-y divide-zinc-100">{approvals.map((t) => <TaskRow key={t.id} task={t} />)}</div>
              ) : (
                <p className="px-5 py-6 text-sm text-zinc-500">Nothing is waiting on a client right now.</p>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {ctx.isStaff && (
            <Card>
              <CardHeader title="My week" />
              <div className="px-5 py-4">
                <p className="text-3xl font-semibold tracking-tight">{formatMinutes(weekMinutes)}</p>
                <p className="mt-1 text-xs text-zinc-500">Logged since Monday · <Link href="/time" className="text-brand-600 hover:underline">Timesheet</Link></p>
              </div>
            </Card>
          )}

          {ctx.isManager && workload.size > 0 && (
            <Card>
              <CardHeader title="Team workload" subtitle="Open tasks per person" />
              <div className="space-y-3 px-5 py-4">
                {[...workload.entries()].sort((a, b) => b[1].open - a[1].open).map(([id, w]) => (
                  <div key={id} className="flex items-center gap-3">
                    <Avatar person={w.person} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between text-xs">
                        <span className="truncate font-medium text-ink">{displayName(w.person)}</span>
                        <span className="text-zinc-500">
                          {w.open}{w.overdue > 0 && <span className="text-coral-500"> · {w.overdue} overdue</span>}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-zinc-100">
                        <div className="h-1.5 rounded-full bg-brand-400" style={{ width: `${(w.open / maxOpen) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {ctx.isStaff && (
            <Card>
              <CardHeader title="Recent activity" />
              <ul className="divide-y divide-zinc-100">
                {((activity.data ?? []) as unknown as { id: number; action: string; entity_type: string; meta: Record<string, unknown> | null; created_at: string; actor: { full_name: string | null; email: string | null } | null }[]).map((a) => (
                  <li key={a.id} className="flex gap-3 px-5 py-2.5">
                    <Avatar person={a.actor} size="sm" />
                    <div className="min-w-0 text-xs">
                      <p className="text-zinc-700">
                        <span className="font-medium text-ink">{displayName(a.actor)}</span> {describe(a)}
                      </p>
                      <p className="mt-0.5 text-zinc-400">{formatDateTime(a.created_at)}</p>
                    </div>
                  </li>
                ))}
                {!(activity.data ?? []).length && <li className="px-5 py-6 text-sm text-zinc-500">No activity yet.</li>}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
