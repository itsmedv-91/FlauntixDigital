import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/auth';
import { deleteMediaPlan, deletePlanLine, setPlanLine, updateMediaPlan } from '@/lib/actions/media';
import { MEDIA_CHANNELS, MEDIA_PLAN_STATUSES } from '@/lib/constants';
import type { MediaPlan, MediaPlanLine, PlanVsActual } from '@/lib/types';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Card, CardHeader, Disclosure, Field, Input, PageHeader, Select, Stat, Textarea } from '@/components/ui';
import { cn, formatDate, formatINR, monthLabel } from '@/lib/utils';

export default async function MediaPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx.isStaff) notFound();

  const { data } = await ctx.supabase
    .from('media_plans')
    .select('*, client:clients(id, name)')
    .eq('id', id)
    .eq('agency_id', ctx.agencyId)
    .maybeSingle();
  if (!data) notFound();

  const plan = data as unknown as MediaPlan & { client: { id: string; name: string } | null };

  const [{ data: lineRows }, summaryRes] = await Promise.all([
    ctx.supabase.from('media_plan_lines').select('*').eq('plan_id', id).order('month').order('channel'),
    ctx.supabase.rpc('media_plan_summary', { plan: id }),
  ]);

  const lines = (lineRows ?? []) as unknown as MediaPlanLine[];
  const summary = ((summaryRes.data ?? []) as unknown as PlanVsActual[]).map((r) => ({
    ...r,
    planned: Number(r.planned),
    actual: Number(r.actual),
    variance: Number(r.variance),
  }));

  const totalPlanned = summary.reduce((s, r) => s + r.planned, 0);
  const totalActual = summary.reduce((s, r) => s + r.actual, 0);
  const st = MEDIA_PLAN_STATUSES.find((s) => s.value === plan.status);
  const months = [...new Set(summary.map((r) => r.month))].sort();

  return (
    <>
      <PageHeader
        back={{ href: '/media-plans', label: 'Media plans' }}
        title={plan.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge className={st?.tone}>{st?.label}</Badge>
            {plan.client && (
              <Link href={`/clients/${plan.client.id}`} className="hover:text-brand-600">{plan.client.name}</Link>
            )}
            <span>· {formatDate(plan.period_start)} – {formatDate(plan.period_end, true)}</span>
          </span>
        }
      />

      {plan.objective && <p className="mb-5 max-w-3xl text-sm text-zinc-600">{plan.objective}</p>}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Planned" value={formatINR(totalPlanned)} />
        <Stat label="Actual spend" value={formatINR(totalActual)} hint="Ad-spend expenses on this client" />
        <Stat
          label={totalActual > totalPlanned ? 'Over budget' : 'Left to spend'}
          value={formatINR(Math.abs(totalPlanned - totalActual))}
          tone={totalActual > totalPlanned ? 'warn' : undefined}
        />
        <Stat label="Months" value={months.length} hint={`${new Set(summary.map((r) => r.channel)).size} channels`} />
      </div>

      <Card className="mb-5 overflow-x-auto">
        <CardHeader
          title="Planned against actual"
          subtitle="Actuals come from expenses categorised as ad spend, matched on channel. A channel spent on but never planned still shows."
        />
        {summary.length === 0 ? (
          <p className="px-5 py-5 text-sm text-zinc-500">No budget lines yet, and no ad spend recorded in this period.</p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500">
                <th className="px-5 py-3 font-medium">Month</th>
                <th className="px-3 py-3 font-medium">Channel</th>
                <th className="px-3 py-3 text-right font-medium">Planned</th>
                <th className="px-3 py-3 text-right font-medium">Actual</th>
                <th className="px-5 py-3 text-right font-medium">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {summary.map((r) => (
                <tr key={`${r.month}-${r.channel}`} className="hover:bg-zinc-50">
                  <td className="px-5 py-3 text-zinc-600">{monthLabel(r.month.slice(0, 7))}</td>
                  <td className="px-3 py-3 font-medium text-ink">
                    {r.channel}
                    {r.planned === 0 && (
                      <Badge className="ml-2 bg-amber-100 text-amber-800">unplanned</Badge>
                    )}
                    {r.actual === 0 && r.planned > 0 && (
                      <Badge className="ml-2 bg-zinc-100 text-zinc-600">not spent</Badge>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-zinc-600">{formatINR(r.planned)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatINR(r.actual)}</td>
                  <td className={cn('px-5 py-3 text-right font-medium tabular-nums', r.variance > 0 ? 'text-coral-500' : 'text-zinc-500')}>
                    {r.variance > 0 ? '+' : ''}
                    {formatINR(r.variance)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-zinc-200 font-semibold">
                <td className="px-5 py-3" colSpan={2}>Total</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatINR(totalPlanned)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatINR(totalActual)}</td>
                <td className={cn('px-5 py-3 text-right tabular-nums', totalActual > totalPlanned ? 'text-coral-500' : 'text-zinc-500')}>
                  {totalActual - totalPlanned > 0 ? '+' : ''}
                  {formatINR(totalActual - totalPlanned)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </Card>

      {ctx.isManager && (
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader title="Budget lines" subtitle="One per channel per month. Entering the same slot again corrects it." />
            {lines.length > 0 && (
              <ul className="divide-y divide-zinc-100">
                {lines.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                    <span className="w-28 shrink-0 text-zinc-600">{monthLabel(l.month.slice(0, 7))}</span>
                    <span className="min-w-0 flex-1 font-medium text-ink">{l.channel}</span>
                    <span className="shrink-0 tabular-nums">{formatINR(Number(l.planned))}</span>
                    <form action={deletePlanLine.bind(null, plan.id, l.id)}>
                      <button className="text-xs text-zinc-400 hover:text-red-600">Remove</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-zinc-100 p-5">
              <Disclosure summary="Add or change a budget line" open={lines.length === 0}>
                <form action={setPlanLine.bind(null, plan.id)} className="grid gap-3 sm:grid-cols-2">
                  <Field label="Channel">
                    <Select name="channel" required defaultValue="Meta">
                      {MEDIA_CHANNELS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Month" hint="Any date in the month works">
                    <Input name="month" type="date" required defaultValue={plan.period_start} />
                  </Field>
                  <Field label="Planned budget (₹)">
                    <Input name="planned" type="number" min="0" step="100" required />
                  </Field>
                  <Field label="Objective for this slot">
                    <Input name="objective" placeholder="e.g. reach" />
                  </Field>
                  <div className="sm:col-span-2">
                    <SubmitButton size="sm">Save line</SubmitButton>
                  </div>
                </form>
              </Disclosure>
            </div>
          </Card>

          <div className="space-y-5">
            <Disclosure summary="Plan details">
              <form action={updateMediaPlan.bind(null, plan.id)} className="space-y-3">
                <Field label="Name">
                  <Input name="name" defaultValue={plan.name} required />
                </Field>
                <Field label="Status">
                  <Select name="status" defaultValue={plan.status}>
                    {MEDIA_PLAN_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Objective">
                  <Input name="objective" defaultValue={plan.objective ?? ''} />
                </Field>
                <Field label="Notes">
                  <Textarea name="notes" rows={3} defaultValue={plan.notes ?? ''} />
                </Field>
                <SubmitButton size="sm">Save plan</SubmitButton>
              </form>
              <form action={deleteMediaPlan.bind(null, plan.id)} className="mt-4 border-t border-zinc-100 pt-4">
                <SubmitButton variant="danger" size="sm" confirm="Delete this plan and its budget lines?" pendingText="Deleting…">
                  Delete plan
                </SubmitButton>
              </form>
            </Disclosure>

            <Card>
              <CardHeader title="Where actuals come from" />
              <p className="px-5 py-4 text-xs text-zinc-500">
                Record ad spend on the{' '}
                <Link href="/profitability?new=1" className="text-brand-600 hover:underline">Profitability</Link> page
                with the category <span className="font-medium text-ink">Ad spend</span> and the channel set. Spend with
                no channel appears here as <span className="font-medium text-ink">Unattributed</span>.
              </p>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
