import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/auth';
import { createMediaPlan } from '@/lib/actions/media';
import { MEDIA_PLAN_STATUSES } from '@/lib/constants';
import type { MediaPlan } from '@/lib/types';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Card, Disclosure, EmptyState, Field, Input, PageHeader, Select, Stat, Textarea } from '@/components/ui';
import { addMonths, formatDate, formatINR, monthIST, monthRange } from '@/lib/utils';

export const metadata = { title: 'Media plans' };

export default async function MediaPlansPage({ searchParams }: { searchParams: Promise<{ client?: string; new?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.isStaff) notFound();

  const thisMonth = monthRange(monthIST());
  const quarterEnd = monthRange(addMonths(monthIST(), 2)).end;

  let q = ctx.supabase
    .from('media_plans')
    .select('*, client:clients(id, name), media_plan_lines(planned)')
    .eq('agency_id', ctx.agencyId);
  if (sp.client) q = q.eq('client_id', sp.client);

  const [{ data, error }, { data: clients }] = await Promise.all([
    q.order('period_start', { ascending: false }).limit(200),
    ctx.supabase.from('clients').select('id, name').eq('agency_id', ctx.agencyId).order('name'),
  ]);

  const plans = (data ?? []) as unknown as (MediaPlan & {
    client: { id: string; name: string } | null;
    media_plan_lines: { planned: number }[];
  })[];
  const planned = (p: (typeof plans)[number]) => p.media_plan_lines.reduce((s, l) => s + Number(l.planned), 0);
  const live = plans.filter((p) => p.status === 'active');

  return (
    <>
      <PageHeader title="Media plans" subtitle="Budget by channel and month, against what was actually spent" />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Plans" value={plans.length} />
        <Stat label="Live" value={live.length} />
        <Stat label="Planned budget (live)" value={formatINR(live.reduce((s, p) => s + planned(p), 0))} />
        <Stat label="Clients covered" value={new Set(plans.map((p) => p.client_id)).size} />
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load plans: {error.message}
        </p>
      )}

      {ctx.isManager && (
        <div className="mb-5 space-y-4">
          <Disclosure summary="New media plan" open={sp.new === '1'}>
            <form action={createMediaPlan} className="grid gap-4 sm:grid-cols-2">
              <Field label="Client">
                <Select name="client_id" required defaultValue={sp.client ?? ''}>
                  <option value="">Choose a client…</option>
                  {(clients ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Plan name">
                <Input name="name" required placeholder="e.g. Diwali quarter — paid" />
              </Field>
              <Field label="From">
                <Input name="period_start" type="date" required defaultValue={thisMonth.start} />
              </Field>
              <Field label="To">
                <Input name="period_end" type="date" required defaultValue={quarterEnd} />
              </Field>
              <Field label="Objective" className="sm:col-span-2">
                <Input name="objective" placeholder="e.g. 2,000 qualified leads at under ₹150 CPL" />
              </Field>
              <Field label="Notes" className="sm:col-span-2">
                <Textarea name="notes" rows={2} />
              </Field>
              <div className="sm:col-span-2">
                <SubmitButton>Create plan</SubmitButton>
              </div>
            </form>
          </Disclosure>

          <form className="flex flex-wrap items-center gap-2" action="/media-plans">
            <Select name="client" defaultValue={sp.client ?? ''} className="w-auto">
              <option value="">All clients</option>
              {(clients ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <button className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-ink ring-1 ring-zinc-200 hover:bg-zinc-50">Apply</button>
          </form>
        </div>
      )}

      {plans.length === 0 ? (
        <EmptyState
          title="No media plans yet"
          body={ctx.isManager ? 'Create one, add a budget per channel per month, and the page tracks it against actual spend.' : 'Plans created by managers appear here.'}
        />
      ) : (
        <Card className="divide-y divide-zinc-100">
          {plans.map((p) => {
            const st = MEDIA_PLAN_STATUSES.find((s) => s.value === p.status);
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <Link href={`/media-plans/${p.id}`} className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink hover:text-brand-600">{p.name}</span>
                  <span className="block truncate text-xs text-zinc-500">
                    {p.client?.name} · {formatDate(p.period_start)} – {formatDate(p.period_end, true)} ·{' '}
                    {formatINR(planned(p))} planned
                  </span>
                </Link>
                <Badge className={st?.tone}>{st?.label}</Badge>
              </div>
            );
          })}
        </Card>
      )}
    </>
  );
}
