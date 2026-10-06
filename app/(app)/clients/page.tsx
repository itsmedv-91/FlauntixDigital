import Link from 'next/link';
import { getContext } from '@/lib/auth';
import { CLIENT_STATUSES } from '@/lib/constants';
import { Avatar, Badge, Card, EmptyState, LinkButton, PageHeader } from '@/components/ui';
import { formatDate, formatINR, todayIST, addDays } from '@/lib/utils';

export const metadata = { title: 'Clients' };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { q, status } = await searchParams;
  const ctx = await getContext();

  let query = ctx.supabase
    .from('clients')
    .select('id, name, industry, status, services, monthly_retainer, contract_end, manager:profiles(full_name, email), tasks(status), projects(status)')
    .eq('agency_id', ctx.agencyId)
    .order('name');
  if (q) query = query.ilike('name', `%${q.replace(/[%_]/g, '')}%`);
  if (status) query = query.eq('status', status);
  const { data } = await query;

  const rows = (data ?? []) as unknown as {
    id: string;
    name: string;
    industry: string | null;
    status: string;
    services: string[];
    monthly_retainer: number | null;
    contract_end: string | null;
    manager: { full_name: string | null; email: string | null } | null;
    tasks: { status: string }[];
    projects: { status: string }[];
  }[];

  const soon = addDays(todayIST(), 30);
  const mrr = rows.filter((r) => r.status === 'active').reduce((s, r) => s + (r.monthly_retainer ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle={ctx.isManager ? `${rows.length} clients · ${formatINR(mrr)} monthly retainers (active)` : `${rows.length} clients`}
        actions={ctx.isManager && <LinkButton href="/clients/new">New client</LinkButton>}
      />

      <form className="mb-4 flex flex-wrap gap-2" action="/clients">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search clients…"
          className="w-64 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
        />
        <select name="status" defaultValue={status ?? ''} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 pr-8 text-sm">
          <option value="">All statuses</option>
          {CLIENT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button className="rounded-lg bg-white px-3 py-2 text-sm font-medium ring-1 ring-zinc-200 hover:bg-zinc-50">Filter</button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title={q || status ? 'No clients match' : 'No clients yet'}
          body="Add your first client to start tracking projects, contacts and credentials."
          action={ctx.isManager && <LinkButton href="/clients/new">Add client</LinkButton>}
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500">
                <th className="px-5 py-3 font-medium">Client</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Open tasks</th>
                <th className="px-3 py-3 font-medium">Active projects</th>
                {ctx.isManager && <th className="px-3 py-3 font-medium">Retainer</th>}
                <th className="px-3 py-3 font-medium">Contract ends</th>
                <th className="px-5 py-3 font-medium">Manager</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((c) => {
                const st = CLIENT_STATUSES.find((s) => s.value === c.status);
                const renewing = c.contract_end && c.contract_end <= soon;
                return (
                  <tr key={c.id} className="hover:bg-zinc-50">
                    <td className="px-5 py-3">
                      <Link href={`/clients/${c.id}`} className="font-medium text-ink hover:text-brand-600">{c.name}</Link>
                      <p className="text-xs text-zinc-500">{c.industry ?? (c.services.slice(0, 2).join(', ') || '—')}</p>
                    </td>
                    <td className="px-3 py-3"><Badge className={st?.tone}>{st?.label}</Badge></td>
                    <td className="px-3 py-3 tabular-nums">{c.tasks.filter((t) => t.status !== 'done').length}</td>
                    <td className="px-3 py-3 tabular-nums">{c.projects.filter((p) => p.status === 'active').length}</td>
                    {ctx.isManager && <td className="px-3 py-3 tabular-nums">{formatINR(c.monthly_retainer)}</td>}
                    <td className={renewing ? 'px-3 py-3 font-medium text-coral-500' : 'px-3 py-3 text-zinc-600'}>
                      {formatDate(c.contract_end, true)}{renewing && ' · renew'}
                    </td>
                    <td className="px-5 py-3">{c.manager ? <Avatar person={c.manager} size="sm" /> : <span className="text-zinc-400">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
