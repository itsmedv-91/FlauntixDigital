import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, getTeam } from '@/lib/auth';
import { deleteProject, updateProject } from '@/lib/actions/projects';
import { createTask } from '@/lib/actions/tasks';
import { PROJECT_STATUSES } from '@/lib/constants';
import type { Project } from '@/lib/types';
import { ProjectForm } from '@/components/project-form';
import { TASK_SELECT } from '@/components/task-bits';
import { TaskBoard, type BoardTask } from '@/components/task-board';
import { TaskForm } from '@/components/task-form';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Disclosure, PageHeader, Stat } from '@/components/ui';
import { displayName, formatDate, formatINR, formatMinutes } from '@/lib/utils';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();

  const { data: project } = await ctx.supabase
    .from('projects')
    .select('*, client:clients(id, name), owner:profiles(full_name, email)')
    .eq('id', id)
    .eq('agency_id', ctx.agencyId)
    .maybeSingle();
  if (!project) notFound();

  const [team, { data: tasks }, { data: time }, { data: clients }] = await Promise.all([
    getTeam(),
    ctx.supabase.from('tasks').select(TASK_SELECT).eq('project_id', id).order('position'),
    ctx.isManager
      ? ctx.supabase.from('time_entries').select('minutes').eq('project_id', id)
      : Promise.resolve({ data: [] as { minutes: number | null }[] }),
    ctx.supabase.from('clients').select('id, name').eq('agency_id', ctx.agencyId).order('name'),
  ]);

  const p = project as Project & { client: { id: string; name: string } | null; owner: { full_name: string | null; email: string | null } | null };
  const items = (tasks ?? []) as unknown as BoardTask[];
  const st = PROJECT_STATUSES.find((s) => s.value === p.status);
  const done = items.filter((t) => t.status === 'done').length;
  const minutes = (time ?? []).reduce((s, e) => s + (e.minutes ?? 0), 0);

  return (
    <>
      <PageHeader
        back={{ href: '/projects', label: 'Projects' }}
        title={p.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge className={st?.tone}>{st?.label}</Badge>
            {p.client ? (
              <Link href={`/clients/${p.client.id}`} className="hover:text-brand-600">{p.client.name}</Link>
            ) : (
              'Internal project'
            )}
            <span>· Lead: {displayName(p.owner)}</span>
            {p.due_date && <span>· Due {formatDate(p.due_date, true)}</span>}
          </span>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Tasks done" value={`${done}/${items.length}`} />
        <Stat label="In client approval" value={items.filter((t) => t.status === 'client_approval').length} />
        {ctx.isManager && <Stat label="Time logged" value={formatMinutes(minutes)} />}
        {ctx.isManager && <Stat label="Budget" value={formatINR(p.budget)} />}
      </div>

      {p.description && <p className="mb-6 max-w-3xl whitespace-pre-wrap text-sm text-zinc-600">{p.description}</p>}

      {ctx.isStaff && (
        <div className="mb-5 space-y-3">
          <Disclosure summary="Add task to this project">
            <TaskForm
              action={createTask}
              projects={[{ id: p.id, name: p.name, client: p.client }]}
              team={team}
              defaults={{ project_id: p.id }}
              redirectTo={`/projects/${p.id}`}
            />
          </Disclosure>
          {ctx.isManager && (
            <Disclosure summary="Edit project">
              <ProjectForm action={updateProject.bind(null, p.id)} clients={clients ?? []} team={team} project={p} submitLabel="Save project" />
              {ctx.isAdmin && (
                <form action={deleteProject.bind(null, p.id)} className="mt-4 border-t border-zinc-100 pt-4">
                  <SubmitButton variant="danger" size="sm" confirm="Delete this project and all its tasks?" pendingText="Deleting…">
                    Delete project
                  </SubmitButton>
                </form>
              )}
            </Disclosure>
          )}
        </div>
      )}

      <TaskBoard tasks={items} />
    </>
  );
}
