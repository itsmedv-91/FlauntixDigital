import Link from 'next/link';
import { getContext, getTeam } from '@/lib/auth';
import { createProject } from '@/lib/actions/projects';
import { PROJECT_STATUSES } from '@/lib/constants';
import { ProjectForm } from '@/components/project-form';
import { Avatar, Badge, Card, Disclosure, EmptyState, PageHeader } from '@/components/ui';
import { formatDate, isOverdue } from '@/lib/utils';

export const metadata = { title: 'Projects' };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const ctx = await getContext();
  const team = await getTeam();

  let q = ctx.supabase
    .from('projects')
    .select('id, name, status, due_date, client:clients(id, name), owner:profiles(full_name, email), tasks(status)')
    .eq('agency_id', ctx.agencyId)
    .order('created_at', { ascending: false });
  q = status === 'all' ? q : status ? q.eq('status', status) : q.in('status', ['planning', 'active', 'on_hold']);

  const [{ data: projects }, { data: clients }] = await Promise.all([
    q,
    ctx.supabase.from('clients').select('id, name').eq('agency_id', ctx.agencyId).neq('status', 'churned').order('name'),
  ]);

  const rows = (projects ?? []) as unknown as {
    id: string;
    name: string;
    status: string;
    due_date: string | null;
    client: { id: string; name: string } | null;
    owner: { full_name: string | null; email: string | null } | null;
    tasks: { status: string }[];
  }[];

  return (
    <>
      <PageHeader title="Projects" subtitle={`${rows.length} ${status === 'all' ? 'total' : 'shown'}`} />

      {ctx.isManager && (
        <div className="mb-5">
          <Disclosure summary="New project">
            <ProjectForm action={createProject} clients={clients ?? []} team={team} />
          </Disclosure>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5 text-sm">
        {[{ value: '', label: 'Open' }, ...PROJECT_STATUSES, { value: 'all', label: 'All' }].map((s) => (
          <Link
            key={s.value}
            href={s.value ? `/projects?status=${s.value}` : '/projects'}
            className={(status ?? '') === s.value ? 'rounded-full bg-ink px-3 py-1 font-medium text-white' : 'rounded-full bg-white px-3 py-1 text-zinc-600 ring-1 ring-zinc-200 hover:text-ink'}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No projects yet" body="Projects group tasks for a client deliverable or retainer month." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => {
            const total = p.tasks.length;
            const done = p.tasks.filter((t) => t.status === 'done').length;
            const pct = total ? Math.round((done / total) * 100) : 0;
            const st = PROJECT_STATUSES.find((s) => s.value === p.status);
            return (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <Card className="h-full p-5 transition hover:border-brand-200 hover:shadow-md">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-zinc-500">{p.client?.name ?? 'Internal'}</p>
                      <h3 className="mt-0.5 truncate font-semibold text-ink">{p.name}</h3>
                    </div>
                    <Badge className={st?.tone}>{st?.label}</Badge>
                  </div>
                  <div className="mt-4">
                    <div className="flex justify-between text-xs text-zinc-500">
                      <span>{done}/{total} tasks done</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-zinc-100">
                      <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-xs">
                    <span className={isOverdue(p.due_date) && p.status !== 'completed' ? 'font-semibold text-coral-500' : 'text-zinc-500'}>
                      {p.due_date ? `Due ${formatDate(p.due_date)}` : 'No deadline'}
                    </span>
                    {p.owner && <Avatar person={p.owner} size="sm" />}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
