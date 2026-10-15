import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/auth';
import { createReport } from '@/lib/actions/reports';
import type { ClientReport } from '@/lib/types';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Card, Disclosure, EmptyState, Field, Input, PageHeader, Select, Stat } from '@/components/ui';
import { addMonths, formatDate, monthIST, monthLabel, monthRange } from '@/lib/utils';

export const metadata = { title: 'Client reports' };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ client?: string; new?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.isStaff) notFound();

  // Default the period to last month, which is what you actually report on.
  const lastMonth = addMonths(monthIST(), -1);
  const { start, end } = monthRange(lastMonth);

  let q = ctx.supabase
    .from('client_reports')
    .select('*, client:clients(id, name)')
    .eq('agency_id', ctx.agencyId);
  if (sp.client) q = q.eq('client_id', sp.client);

  const [{ data, error }, { data: clients }] = await Promise.all([
    q.order('period_start', { ascending: false }).limit(200),
    ctx.supabase.from('clients').select('id, name').eq('agency_id', ctx.agencyId).order('name'),
  ]);

  const reports = (data ?? []) as unknown as (ClientReport & { client: { id: string; name: string } | null })[];
  const sent = reports.filter((r) => r.status === 'sent');

  return (
    <>
      <PageHeader title="Client reports" subtitle="What you did, what is live, what is next" />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Reports" value={reports.length} />
        <Stat label="Sent" value={sent.length} />
        <Stat label="Drafts" value={reports.length - sent.length} />
        <Stat label="Clients covered" value={new Set(reports.map((r) => r.client_id)).size} />
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load reports: {error.message}
        </p>
      )}

      <div className="mb-5 space-y-4">
        <Disclosure summary="New report" open={sp.new === '1'}>
          <form action={createReport} className="grid gap-4 sm:grid-cols-2">
            <Field label="Client">
              <Select name="client_id" required defaultValue={sp.client ?? ''}>
                <option value="">Choose a client…</option>
                {(clients ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Title">
              <Input name="title" defaultValue={`${monthLabel(lastMonth)} report`} />
            </Field>
            <Field label="Period from">
              <Input name="period_start" type="date" required defaultValue={start} />
            </Field>
            <Field label="Period to">
              <Input name="period_end" type="date" required defaultValue={end} />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton pendingText="Building…">Create and build</SubmitButton>
              <p className="mt-2 text-xs text-zinc-500">
                The figures are pulled from the calendar, approvals and tasks. You add the commentary next.
              </p>
            </div>
          </form>
        </Disclosure>

        <form className="flex flex-wrap items-center gap-2" action="/reports">
          <Select name="client" defaultValue={sp.client ?? ''} className="w-auto">
            <option value="">All clients</option>
            {(clients ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <button className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-ink ring-1 ring-zinc-200 hover:bg-zinc-50">Apply</button>
        </form>
      </div>

      {reports.length === 0 ? (
        <EmptyState
          title="No reports yet"
          body="Create one for last month — the figures assemble themselves from what is already in the platform."
        />
      ) : (
        <Card className="divide-y divide-zinc-100">
          {reports.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <Link href={`/reports/${r.id}`} className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink hover:text-brand-600">{r.title}</span>
                <span className="block truncate text-xs text-zinc-500">
                  {r.client?.name} · {formatDate(r.period_start)} – {formatDate(r.period_end, true)}
                  {r.snapshot?.counts ? ` · ${r.snapshot.counts.published} published` : ''}
                </span>
              </Link>
              <Badge className={r.status === 'sent' ? 'bg-emerald-100 text-emerald-800' : 'bg-zinc-100 text-zinc-700'}>
                {r.status === 'sent' ? `Sent ${formatDate(r.sent_at)}` : 'Draft'}
              </Badge>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
