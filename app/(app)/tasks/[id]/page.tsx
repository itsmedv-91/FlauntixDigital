import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, getTeam } from '@/lib/auth';
import { addComment, addRevision, deleteComment, deleteTask, updateTask } from '@/lib/actions/tasks';
import { startTimer, deleteTimeEntry } from '@/lib/actions/time';
import { TASK_STATUSES } from '@/lib/constants';
import type { Task } from '@/lib/types';
import { DueDate, PriorityBadge, StatusBadge } from '@/components/task-bits';
import { TaskForm } from '@/components/task-form';
import { SubmitButton } from '@/components/submit-button';
import { Avatar, Card, CardHeader, PageHeader, Select, Textarea } from '@/components/ui';
import { displayName, formatDate, formatDateTime, formatMinutes } from '@/lib/utils';

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();

  const { data: task } = await ctx.supabase
    .from('tasks')
    .select('*, project:projects(id, name), client:clients(id, name), assignee:profiles!tasks_assignee_id_fkey(id, full_name, email), creator:profiles!tasks_created_by_fkey(id, full_name, email)')
    .eq('id', id)
    .eq('agency_id', ctx.agencyId)
    .maybeSingle();
  if (!task) notFound();

  const [team, { data: comments }, { data: entries }, { data: projects }] = await Promise.all([
    getTeam(),
    ctx.supabase.from('task_comments').select('id, body, created_at, author_id, author:profiles(full_name, email)').eq('task_id', id).order('created_at'),
    ctx.supabase.from('time_entries').select('id, minutes, started_at, ended_at, note, user_id, user:profiles(full_name, email)').eq('task_id', id).order('started_at', { ascending: false }),
    ctx.isStaff
      ? ctx.supabase.from('projects').select('id, name, client:clients(name)').eq('agency_id', ctx.agencyId).order('name')
      : Promise.resolve({ data: [] }),
  ]);

  const t = task as Task & {
    project: { id: string; name: string } | null;
    client: { id: string; name: string } | null;
    assignee: { full_name: string | null; email: string | null } | null;
    creator: { full_name: string | null; email: string | null } | null;
  };
  const totalMinutes = (entries ?? []).reduce((s, e) => s + (e.minutes ?? 0), 0);
  const overRevisions = t.max_revisions !== null && t.revision_count > t.max_revisions;

  return (
    <>
      <PageHeader
        back={t.project ? { href: `/projects/${t.project.id}`, label: t.project.name } : { href: '/tasks', label: 'Tasks' }}
        title={t.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={t.status} />
            <PriorityBadge priority={t.priority} />
            <DueDate date={t.due_date} status={t.status} />
            {t.client && (
              <Link href={`/clients/${t.client.id}`} className="text-xs text-zinc-500 hover:text-brand-600">
                {t.client.name}
              </Link>
            )}
          </span>
        }
        actions={
          <form action={startTimer}>
            <input type="hidden" name="task_id" value={t.id} />
            <SubmitButton variant="secondary" pendingText="Starting…">▶ Start timer</SubmitButton>
          </form>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          {ctx.isStaff ? (
            <Card>
              <CardHeader title="Details" />
              <div className="p-5">
                <TaskForm
                  action={updateTask.bind(null, t.id)}
                  projects={(projects ?? []) as never}
                  team={team}
                  task={t}
                  submitLabel="Save changes"
                />
              </div>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Brief" />
              <div className="space-y-4 p-5">
                <p className="whitespace-pre-wrap text-sm text-zinc-700">{t.description || 'No description.'}</p>
                <form action={updateTask.bind(null, t.id)} className="flex items-end gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-zinc-600">Move to</span>
                    <Select name="status" defaultValue={t.status} className="w-auto">
                      {TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </Select>
                  </label>
                  <SubmitButton>Update status</SubmitButton>
                </form>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Comments" subtitle={`${comments?.length ?? 0} so far`} />
            <ul className="divide-y divide-zinc-100">
              {((comments ?? []) as unknown as { id: string; body: string; created_at: string; author_id: string; author: { full_name: string | null; email: string | null } | null }[]).map((c) => (
                <li key={c.id} className="flex gap-3 px-5 py-3.5">
                  <Avatar person={c.author} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs">
                      <span className="font-semibold text-ink">{displayName(c.author)}</span>
                      <span className="ml-2 text-zinc-400">{formatDateTime(c.created_at)}</span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700">{c.body}</p>
                  </div>
                  {(c.author_id === ctx.user.id || ctx.isManager) && (
                    <form action={deleteComment.bind(null, t.id, c.id)}>
                      <button className="text-xs text-zinc-400 hover:text-red-600">Delete</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            <form action={addComment.bind(null, t.id)} className="space-y-2 border-t border-zinc-100 p-5">
              <Textarea name="body" required placeholder="Write an update, feedback or question…" />
              <SubmitButton size="sm" pendingText="Posting…">Comment</SubmitButton>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Overview" />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-5 text-sm">
              <dt className="text-zinc-500">Assignee</dt>
              <dd className="flex items-center gap-2">{t.assignee ? <><Avatar person={t.assignee} size="sm" /> {displayName(t.assignee)}</> : 'Unassigned'}</dd>
              <dt className="text-zinc-500">Created by</dt>
              <dd>{displayName(t.creator)}</dd>
              <dt className="text-zinc-500">Created</dt>
              <dd>{formatDate(t.created_at)}</dd>
              <dt className="text-zinc-500">Estimate</dt>
              <dd>{t.estimate_hours ? `${t.estimate_hours}h` : '—'}</dd>
              <dt className="text-zinc-500">Time logged</dt>
              <dd className={t.estimate_hours && totalMinutes > t.estimate_hours * 60 ? 'font-semibold text-coral-500' : ''}>{formatMinutes(totalMinutes)}</dd>
              {t.completed_at && (<><dt className="text-zinc-500">Completed</dt><dd>{formatDate(t.completed_at)}</dd></>)}
            </dl>
          </Card>

          <Card>
            <CardHeader
              title="Revisions"
              subtitle={t.max_revisions !== null ? `${t.max_revisions} included in scope` : 'No limit set'}
              action={ctx.isStaff && (
                <form action={addRevision.bind(null, t.id)}>
                  <SubmitButton size="sm" variant="secondary" pendingText="…">+ Revision</SubmitButton>
                </form>
              )}
            />
            <div className="px-5 py-4">
              <p className={overRevisions ? 'text-2xl font-semibold text-coral-500' : 'text-2xl font-semibold'}>{t.revision_count}</p>
              {overRevisions && (
                <p className="mt-1 text-xs text-coral-500">
                  {t.revision_count - (t.max_revisions ?? 0)} over scope. Consider raising a change request with the client.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Time entries" />
            <ul className="divide-y divide-zinc-100">
              {((entries ?? []) as unknown as { id: string; minutes: number | null; started_at: string; ended_at: string | null; note: string | null; user_id: string; user: { full_name: string | null; email: string | null } | null }[]).map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <Avatar person={e.user} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-zinc-500">{formatDateTime(e.started_at)}{e.note ? ` · ${e.note}` : ''}</p>
                  </div>
                  <span className="font-medium tabular-nums">{e.ended_at ? formatMinutes(e.minutes) : 'Running'}</span>
                  {e.user_id === ctx.user.id && e.ended_at && (
                    <form action={deleteTimeEntry.bind(null, e.id)}>
                      <button className="text-xs text-zinc-400 hover:text-red-600" aria-label="Delete entry">✕</button>
                    </form>
                  )}
                </li>
              ))}
              {!(entries ?? []).length && <li className="px-5 py-4 text-sm text-zinc-500">No time logged yet.</li>}
            </ul>
          </Card>

          {ctx.isStaff && (
            <form action={deleteTask.bind(null, t.id)}>
              <SubmitButton variant="danger" size="sm" confirm="Delete this task permanently?" pendingText="Deleting…">
                Delete task
              </SubmitButton>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
