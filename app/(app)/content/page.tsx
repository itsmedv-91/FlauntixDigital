import Link from 'next/link';
import { getContext, getTeam } from '@/lib/auth';
import { createContent } from '@/lib/actions/content';
import { CONTENT_STATUSES } from '@/lib/constants';
import { ContentBoard, type BoardContent } from '@/components/content-board';
import { ContentCalendar } from '@/components/content-calendar';
import { ContentForm } from '@/components/content-form';
import { Disclosure, EmptyState, PageHeader, Select, Stat } from '@/components/ui';
import { addDays, addMonths, cn, displayName, monthIST, monthLabel, monthRange } from '@/lib/utils';

export const metadata = { title: 'Content' };

const CONTENT_SELECT =
  'id, title, status, format, platforms, scheduled_date, scheduled_time, revision_count, max_revisions, ' +
  'client:clients(id, name), assignee:profiles(full_name, email)';

type Search = { view?: string; month?: string; client?: string; assignee?: string; status?: string; new?: string };

export default async function ContentPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const team = await getTeam();

  const view = sp.view === 'board' ? 'board' : 'calendar';
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? sp.month! : monthIST();
  const { start, end } = monthRange(month);

  let q = ctx.supabase.from('content_items').select(CONTENT_SELECT).eq('agency_id', ctx.agencyId);
  if (sp.client) q = q.eq('client_id', sp.client);
  if (sp.assignee) q = sp.assignee === 'none' ? q.is('assignee_id', null) : q.eq('assignee_id', sp.assignee);
  if (sp.status) q = q.eq('status', sp.status);

  if (view === 'calendar') {
    // A week either side covers the leading and trailing cells of the grid;
    // undated items ride along for the unscheduled tray.
    q = q.or(`scheduled_date.is.null,and(scheduled_date.gte.${addDays(start, -7)},scheduled_date.lte.${addDays(end, 7)})`);
  } else {
    q = q.neq('status', 'archived');
  }

  const [{ data, error }, { data: clients }, { data: projects }, { count: awaiting }] = await Promise.all([
    q.order('scheduled_date', { ascending: true, nullsFirst: false }).limit(500),
    ctx.supabase.from('clients').select('id, name').eq('agency_id', ctx.agencyId).order('name'),
    ctx.supabase
      .from('projects')
      .select('id, name, client_id')
      .eq('agency_id', ctx.agencyId)
      .in('status', ['planning', 'active', 'on_hold'])
      .order('name'),
    ctx.supabase
      .from('content_items')
      .select('id', { count: 'exact', head: true })
      .eq('agency_id', ctx.agencyId)
      .eq('status', 'client_approval'),
  ]);

  const items = (data ?? []) as unknown as BoardContent[];
  const inMonth = items.filter((i) => i.scheduled_date && i.scheduled_date >= start && i.scheduled_date <= end);
  const published = inMonth.filter((i) => i.status === 'published').length;
  const changes = items.filter((i) => i.status === 'changes_requested').length;

  const link = (patch: Partial<Search>) => {
    const next = new URLSearchParams();
    const merged = { ...sp, ...patch, new: undefined };
    Object.entries(merged).forEach(([k, v]) => v && next.set(k, String(v)));
    const qs = next.toString();
    return qs ? `/content?${qs}` : '/content';
  };

  return (
    <>
      <PageHeader
        title="Content"
        subtitle={view === 'calendar' ? monthLabel(month) : 'Production pipeline'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5 text-sm">
              {(['calendar', 'board'] as const).map((v) => (
                <Link
                  key={v}
                  href={link({ view: v === 'calendar' ? undefined : v })}
                  className={cn('rounded-md px-3 py-1.5 font-medium capitalize', view === v ? 'bg-ink text-white' : 'text-zinc-600 hover:text-ink')}
                >
                  {v}
                </Link>
              ))}
            </div>
            {view === 'calendar' && (
              <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white p-0.5 text-sm">
                <Link href={link({ month: addMonths(month, -1) })} className="rounded-md px-2.5 py-1.5 text-zinc-600 hover:text-ink" aria-label="Previous month">
                  ←
                </Link>
                <Link
                  href={link({ month: undefined })}
                  className={cn('rounded-md px-2.5 py-1.5 font-medium', month === monthIST() ? 'bg-ink text-white' : 'text-zinc-600 hover:text-ink')}
                >
                  This month
                </Link>
                <Link href={link({ month: addMonths(month, 1) })} className="rounded-md px-2.5 py-1.5 text-zinc-600 hover:text-ink" aria-label="Next month">
                  →
                </Link>
              </div>
            )}
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Planned this month" value={inMonth.length} hint={monthLabel(month)} />
        <Stat label="Published" value={published} hint="This month" />
        <Stat label="With client" value={awaiting ?? 0} tone={awaiting ? 'warn' : undefined} hint="Waiting on approval" />
        <Stat label="Changes requested" value={changes} tone={changes ? 'warn' : undefined} />
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load content: {error.message}
        </p>
      )}

      {ctx.isStaff && (
        <div className="mb-5 space-y-4">
          <Disclosure summary="New content" open={sp.new === '1'}>
            <ContentForm
              action={createContent}
              clients={clients ?? []}
              projects={projects ?? []}
              team={team}
              defaults={{ client_id: sp.client, scheduled_date: month === monthIST() ? undefined : start }}
            />
          </Disclosure>

          <form className="flex flex-wrap items-center gap-2" action="/content">
            {view === 'board' && <input type="hidden" name="view" value="board" />}
            {view === 'calendar' && month !== monthIST() && <input type="hidden" name="month" value={month} />}
            <Select name="client" defaultValue={sp.client ?? ''} className="w-auto">
              <option value="">All clients</option>
              {(clients ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <Select name="assignee" defaultValue={sp.assignee ?? ''} className="w-auto">
              <option value="">Any owner</option>
              <option value="none">Unassigned</option>
              {team.map((m) => (
                <option key={m.user_id} value={m.user_id}>{displayName(m.profile)}</option>
              ))}
            </Select>
            <Select name="status" defaultValue={sp.status ?? ''} className="w-auto">
              <option value="">Any status</option>
              {CONTENT_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <button className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-ink ring-1 ring-zinc-200 hover:bg-zinc-50">Apply</button>
          </form>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          title={view === 'calendar' ? 'Nothing planned this month' : 'The pipeline is empty'}
          body={ctx.isStaff ? 'Add a post above, or check the filters and the month you are looking at.' : 'Content assigned to you will show up here.'}
        />
      ) : view === 'calendar' ? (
        <ContentCalendar month={month} items={items} canDrag={ctx.isStaff} />
      ) : (
        <ContentBoard items={items} canDrag={ctx.isStaff} />
      )}
    </>
  );
}
