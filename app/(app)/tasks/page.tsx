import Link from 'next/link';
import { getContext, getTeam } from '@/lib/auth';
import { createTask } from '@/lib/actions/tasks';
import { TASK_SELECT, TaskRow } from '@/components/task-bits';
import { TaskBoard, type BoardTask } from '@/components/task-board';
import { TaskForm } from '@/components/task-form';
import { Card, Disclosure, EmptyState, PageHeader, Select } from '@/components/ui';
import { cn, displayName } from '@/lib/utils';

export const metadata = { title: 'Tasks' };

type Search = { view?: string; mine?: string; client?: string; assignee?: string; done?: string; new?: string };

export default async function TasksPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const team = await getTeam();
  const view = sp.view === 'list' ? 'list' : 'board';
  const mine = sp.mine === '1' || !ctx.isStaff;

  let q = ctx.supabase.from('tasks').select(TASK_SELECT).eq('agency_id', ctx.agencyId);
  if (mine) q = q.eq('assignee_id', ctx.user.id);
  else if (sp.assignee) q = sp.assignee === 'none' ? q.is('assignee_id', null) : q.eq('assignee_id', sp.assignee);
  if (sp.client) q = q.eq('client_id', sp.client);
  if (view === 'list' && sp.done !== '1') q = q.neq('status', 'done');
  if (view === 'board') {
    // Keep the Done column light: only the last 30 days.
    const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
    q = q.or(`status.neq.done,completed_at.gte."${cutoff}"`);
  }
  const [{ data: tasks }, { data: projects }, { data: clients }] = await Promise.all([
    q.order('position').limit(500),
    ctx.supabase.from('projects').select('id, name, client:clients(name)').eq('agency_id', ctx.agencyId)
      .in('status', ['planning', 'active', 'on_hold']).order('name'),
    ctx.isStaff
      ? ctx.supabase.from('clients').select('id, name').eq('agency_id', ctx.agencyId).order('name')
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const items = (tasks ?? []) as unknown as BoardTask[];
  const params = (patch: Partial<Search>) => {
    const next = new URLSearchParams();
    const merged = { ...sp, ...patch, new: undefined };
    Object.entries(merged).forEach(([k, v]) => v && next.set(k, v));
    return `/tasks?${next.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle={mine ? 'Assigned to you' : 'Everything across the agency'}
        actions={
          <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5 text-sm">
            {(['board', 'list'] as const).map((v) => (
              <Link key={v} href={params({ view: v === 'board' ? undefined : v })}
                className={cn('rounded-md px-3 py-1.5 font-medium capitalize', view === v ? 'bg-ink text-white' : 'text-zinc-600 hover:text-ink')}>
                {v}
              </Link>
            ))}
          </div>
        }
      />

      {ctx.isStaff && (
        <div className="mb-5 space-y-4">
          <Disclosure summary="New task" open={sp.new === '1'}>
            <TaskForm action={createTask} projects={(projects ?? []) as never} team={team} defaults={{ assignee_id: ctx.user.id }} />
          </Disclosure>

          <form className="flex flex-wrap items-center gap-2" action="/tasks">
            {view === 'list' && <input type="hidden" name="view" value="list" />}
            <Select name="mine" defaultValue={mine ? '1' : ''} className="w-auto">
              <option value="">Everyone&apos;s tasks</option>
              <option value="1">My tasks</option>
            </Select>
            <Select name="assignee" defaultValue={sp.assignee ?? ''} className="w-auto">
              <option value="">Any assignee</option>
              <option value="none">Unassigned</option>
              {team.map((m) => <option key={m.user_id} value={m.user_id}>{displayName(m.profile)}</option>)}
            </Select>
            <Select name="client" defaultValue={sp.client ?? ''} className="w-auto">
              <option value="">All clients</option>
              {(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            {view === 'list' && (
              <label className="flex items-center gap-1.5 text-sm text-zinc-600">
                <input type="checkbox" name="done" value="1" defaultChecked={sp.done === '1'} /> Show done
              </label>
            )}
            <button className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-ink ring-1 ring-zinc-200 hover:bg-zinc-50">Apply</button>
          </form>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState title="No tasks here" body={ctx.isStaff ? 'Create a task above, or change the filters.' : 'Tasks assigned to you will show up here.'} />
      ) : view === 'board' ? (
        <TaskBoard tasks={items} />
      ) : (
        <Card className="divide-y divide-zinc-100">
          {[...items].sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')).map((t) => <TaskRow key={t.id} task={t} />)}
        </Card>
      )}
    </>
  );
}
