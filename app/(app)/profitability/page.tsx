import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/auth';
import { addExpense, deleteExpense, setHourlyCost } from '@/lib/actions/expenses';
import { EXPENSE_CATEGORIES } from '@/lib/constants';
import type { AgencyMargin, ClientMargin, Expense, MemberRole, Profile } from '@/lib/types';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Card, CardHeader, Disclosure, EmptyState, Field, Input, PageHeader, Select, Stat, Textarea } from '@/components/ui';
import {
  addMonths,
  cn,
  displayName,
  formatDate,
  formatINR,
  fyQuarterRange,
  fyRange,
  monthIST,
  monthLabel,
  monthRange,
  todayIST,
} from '@/lib/utils';

export const metadata = { title: 'Profitability' };

type Search = { p?: string; from?: string; to?: string; new?: string };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function resolvePeriod(sp: Search) {
  if (sp.from && sp.to && ISO.test(sp.from) && ISO.test(sp.to) && sp.from <= sp.to) {
    return { from: sp.from, to: sp.to, label: `${formatDate(sp.from, true)} – ${formatDate(sp.to, true)}` };
  }
  const today = todayIST();
  switch (sp.p) {
    case 'last': {
      const month = addMonths(monthIST(), -1);
      const { start, end } = monthRange(month);
      return { from: start, to: end, label: monthLabel(month) };
    }
    case 'quarter': {
      const q = fyQuarterRange(today);
      return { from: q.start, to: q.end, label: q.label };
    }
    case 'fy': {
      const f = fyRange(today);
      return { from: f.start, to: f.end, label: `FY ${f.start.slice(2, 4)}-${f.end.slice(2, 4)}` };
    }
    default: {
      const { start, end } = monthRange(monthIST());
      return { from: start, to: end, label: monthLabel(monthIST()) };
    }
  }
}

export default async function ProfitabilityPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  // Costs and margins are managers and above, matching the RPCs' own check.
  if (!ctx.isManager) notFound();

  const { from, to, label } = resolvePeriod(sp);

  const [clientRes, agencyRes, unpricedRes, expenseRes, clientListRes, memberRes] = await Promise.all([
    ctx.supabase.rpc('client_profitability', { agency: ctx.agencyId, from_date: from, to_date: to }),
    ctx.supabase.rpc('agency_profitability', { agency: ctx.agencyId, from_date: from, to_date: to }),
    ctx.supabase.rpc('unpriced_contributors', { agency: ctx.agencyId, from_date: from, to_date: to }),
    ctx.supabase
      .from('expenses')
      .select('*, client:clients(id, name)')
      .eq('agency_id', ctx.agencyId)
      .gte('incurred_on', from)
      .lte('incurred_on', to)
      .order('incurred_on', { ascending: false }),
    ctx.supabase.from('clients').select('id, name').eq('agency_id', ctx.agencyId).order('name'),
    // Queried here rather than through getTeam(), which is used on pages every
    // member can open — pay rates stay on this managers-only page.
    ctx.supabase
      .from('memberships')
      .select('user_id, role, active, hourly_cost, profile:profiles(id, full_name, email, avatar_url, job_title, skills)')
      .eq('agency_id', ctx.agencyId)
      .eq('active', true)
      .order('created_at'),
  ]);

  const rows = ((clientRes.data ?? []) as unknown as ClientMargin[]).map((r) => ({
    ...r,
    revenue: Number(r.revenue),
    expected_retainer: Number(r.expected_retainer),
    labour_cost: Number(r.labour_cost),
    expense_cost: Number(r.expense_cost),
    total_cost: Number(r.total_cost),
    margin: Number(r.margin),
    margin_pct: r.margin_pct === null ? null : Number(r.margin_pct),
    hours: Number(r.hours),
    billable_hours: Number(r.billable_hours),
    effective_rate: r.effective_rate === null ? null : Number(r.effective_rate),
    unpriced_hours: Number(r.unpriced_hours),
  }));
  const agencyRow = ((agencyRes.data ?? []) as unknown as AgencyMargin[])[0];
  const agency = agencyRow
    ? {
        revenue: Number(agencyRow.revenue),
        direct_cost: Number(agencyRow.direct_cost),
        overhead_cost: Number(agencyRow.overhead_cost),
        overhead_hours: Number(agencyRow.overhead_hours),
        margin: Number(agencyRow.margin),
        margin_pct: agencyRow.margin_pct === null ? null : Number(agencyRow.margin_pct),
        client_hours: Number(agencyRow.client_hours),
        unpriced_hours: Number(agencyRow.unpriced_hours),
      }
    : null;
  const unpriced = (unpricedRes.data ?? []) as unknown as {
    user_id: string;
    full_name: string | null;
    email: string | null;
    hours: number;
  }[];
  const expenses = (expenseRes.data ?? []) as unknown as (Expense & { client: { id: string; name: string } | null })[];
  const clients = clientListRes.data ?? [];
  const members = ((memberRes.data ?? []) as unknown as {
    user_id: string;
    role: MemberRole;
    active: boolean;
    hourly_cost: number | null;
    profile: Profile | null;
  }[]).filter((m) => m.profile);
  const error = clientRes.error ?? agencyRes.error ?? expenseRes.error;

  const byCategory = new Map<string, number>();
  for (const e of expenses) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + Number(e.amount));

  const link = (patch: Partial<Search>) => {
    const next = new URLSearchParams();
    Object.entries({ ...sp, ...patch, new: undefined }).forEach(([k, v]) => v && next.set(k, String(v)));
    const qs = next.toString();
    return qs ? `/profitability?${qs}` : '/profitability';
  };
  const presets: { key: string; label: string }[] = [
    { key: 'month', label: 'This month' },
    { key: 'last', label: 'Last month' },
    { key: 'quarter', label: 'This quarter' },
    { key: 'fy', label: 'This FY' },
  ];
  const activePreset = sp.from && sp.to ? '' : sp.p ?? 'month';

  return (
    <>
      <PageHeader
        title="Profitability"
        subtitle={label}
        actions={
          <div className="flex flex-wrap rounded-lg border border-zinc-200 bg-white p-0.5 text-sm">
            {presets.map((p) => (
              <Link
                key={p.key}
                href={link({ p: p.key === 'month' ? undefined : p.key, from: undefined, to: undefined })}
                className={cn(
                  'rounded-md px-3 py-1.5 font-medium',
                  activePreset === p.key ? 'bg-ink text-white' : 'text-zinc-600 hover:text-ink',
                )}
              >
                {p.label}
              </Link>
            ))}
          </div>
        }
      />

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load the numbers: {error.message}
        </p>
      )}

      {agency && (
        <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Revenue" value={formatINR(agency.revenue)} hint="Invoiced, excluding GST" />
          <Stat label="Cost of serving clients" value={formatINR(agency.direct_cost)} hint={`${agency.client_hours} client hours`} />
          <Stat label="Overhead" value={formatINR(agency.overhead_cost)} hint={`${agency.overhead_hours} internal hours`} />
          <Stat
            label="Margin"
            value={formatINR(agency.margin)}
            tone={agency.margin < 0 ? 'warn' : undefined}
            hint={agency.margin_pct === null ? 'No revenue in this period' : `${agency.margin_pct}% of revenue`}
          />
        </div>
      )}

      {unpriced.length > 0 && (
        <Card className="mb-5 border-amber-300/70">
          <CardHeader
            title="Some time in this period is costed at zero"
            subtitle="These people have no hourly cost set, so their hours make every margin below look better than it is."
          />
          <ul className="divide-y divide-zinc-100">
            {unpriced.map((u) => (
              <li key={u.user_id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-ink">{displayName(u)}</span>
                  <span className="ml-2 text-zinc-500">{Number(u.hours)} hours unpriced</span>
                </span>
                <form action={setHourlyCost.bind(null, u.user_id)} className="flex items-end gap-2">
                  <Input
                    name="hourly_cost"
                    type="number"
                    min="0"
                    step="50"
                    required
                    placeholder="₹ / hour"
                    className="w-28 py-1.5 text-xs"
                  />
                  <SubmitButton variant="secondary" size="sm" pendingText="…">Set cost</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
          <p className="border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">
            Setting a cost applies to time logged from now on. Past entries keep the rate they were stamped with, so
            earlier months do not change — re-stamping history is deliberately not possible here.
          </p>
        </Card>
      )}

      <Card className="mb-5 overflow-x-auto">
        <CardHeader
          title="By client"
          subtitle="Revenue is invoiced in this period; hours and costs are when the work happened. Those differ at a month boundary."
        />
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="Nothing to measure yet"
              body="Once there is logged time, an issued invoice or a recorded cost in this period, margins appear here."
            />
          </div>
        ) : (
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500">
                <th className="px-5 py-3 font-medium">Client</th>
                <th className="px-3 py-3 text-right font-medium">Revenue</th>
                <th className="px-3 py-3 text-right font-medium">Hours</th>
                <th className="px-3 py-3 text-right font-medium">Labour</th>
                <th className="px-3 py-3 text-right font-medium">Costs</th>
                <th className="px-3 py-3 text-right font-medium">Margin</th>
                <th className="px-3 py-3 text-right font-medium">%</th>
                <th className="px-5 py-3 text-right font-medium">₹ / hour</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((r) => {
                const shortfall = r.expected_retainer > 0 && r.revenue < r.expected_retainer;
                return (
                  <tr key={r.client_id} className="hover:bg-zinc-50">
                    <td className="px-5 py-3">
                      <Link href={`/clients/${r.client_id}`} className="font-medium text-ink hover:text-brand-600">
                        {r.client_name}
                      </Link>
                      <span className="mt-0.5 block space-x-1.5">
                        {shortfall && (
                          <Badge className="bg-amber-100 text-amber-800">
                            {formatINR(r.expected_retainer - r.revenue)} under retainer
                          </Badge>
                        )}
                        {r.unpriced_hours > 0 && (
                          <Badge className="bg-zinc-100 text-zinc-600">{r.unpriced_hours}h unpriced</Badge>
                        )}
                        {r.rebilled_expense > 0 && (
                          <Badge className="bg-zinc-100 text-zinc-600">
                            {formatINR(Number(r.rebilled_expense))} passed through
                          </Badge>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatINR(r.revenue)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-zinc-600">
                      {r.hours}
                      {r.billable_hours !== r.hours && (
                        <span className="block text-xs text-zinc-400">{r.billable_hours} billable</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-zinc-600">{formatINR(r.labour_cost)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-zinc-600">{formatINR(r.expense_cost)}</td>
                    <td
                      className={cn(
                        'px-3 py-3 text-right font-medium tabular-nums',
                        r.margin < 0 ? 'text-coral-500' : 'text-ink',
                      )}
                    >
                      {formatINR(r.margin)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-3 text-right tabular-nums',
                        r.margin_pct === null ? 'text-zinc-400' : r.margin_pct < 0 ? 'text-coral-500' : 'text-zinc-600',
                      )}
                    >
                      {r.margin_pct === null ? '—' : `${r.margin_pct}%`}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-zinc-600">
                      {r.effective_rate === null ? '—' : formatINR(r.effective_rate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader
            title="Costs in this period"
            subtitle={expenses.length ? `${formatINR(expenses.reduce((s, e) => s + Number(e.amount), 0))} in total` : 'Nothing recorded yet'}
          />
          {expenses.length > 0 && (
            <ul className="divide-y divide-zinc-100">
              {expenses.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <span className="w-24 shrink-0 font-medium tabular-nums text-ink">{formatINR(Number(e.amount))}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{e.description}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {[e.category, e.client?.name ?? 'Overhead', e.vendor, formatDate(e.incurred_on)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {e.rebilled && <Badge className="bg-brand-50 text-brand-700">Rebilled</Badge>}
                  <form action={deleteExpense.bind(null, e.id)}>
                    <button className="text-xs text-zinc-400 hover:text-red-600">Remove</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-zinc-100 p-5">
            <Disclosure summary="Record a cost" open={sp.new === '1'}>
              <form action={addExpense} className="grid gap-4 sm:grid-cols-2">
                <Field label="What was it for?" className="sm:col-span-2">
                  <Input name="description" required placeholder="e.g. Meta ad spend for the Diwali campaign" />
                </Field>
                <Field label="Amount (₹)">
                  <Input name="amount" type="number" min="0" step="0.01" required />
                </Field>
                <Field label="Date">
                  <Input name="incurred_on" type="date" defaultValue={todayIST()} max={todayIST()} />
                </Field>
                <Field label="Category">
                  <Select name="category" defaultValue="Ad spend">
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Client" hint="Leave empty for agency overhead">
                  <Select name="client_id" defaultValue="">
                    <option value="">Agency overhead</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Vendor">
                  <Input name="vendor" placeholder="Who you paid" />
                </Field>
                <Field label="Notes">
                  <Textarea name="notes" rows={1} />
                </Field>
                <label className="flex items-start gap-2 text-sm text-zinc-700 sm:col-span-2">
                  <input type="checkbox" name="rebilled" className="mt-1" />
                  <span>
                    Rebilled to the client
                    <span className="block text-xs text-zinc-500">
                      It still counts as a cost — the invoice line that recovers it counts as revenue, so a
                      pass-through nets to zero rather than flattering the margin.
                    </span>
                  </span>
                </label>
                <div className="sm:col-span-2">
                  <SubmitButton>Record cost</SubmitButton>
                </div>
              </form>
            </Disclosure>
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Costs by category" />
            {byCategory.size === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-500">Nothing recorded in this period.</p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {[...byCategory.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([category, amount]) => (
                    <li key={category} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                      <span className="truncate text-zinc-700">{category}</span>
                      <span className="shrink-0 tabular-nums text-zinc-500">{formatINR(amount)}</span>
                    </li>
                  ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Cost rates" subtitle="What an hour of each person's time costs the agency" />
            <ul className="divide-y divide-zinc-100">
              {members.map((m) => (
                  <li key={m.user_id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-sm">
                    <span className="min-w-0 flex-1 truncate text-zinc-700">{displayName(m.profile)}</span>
                    <form action={setHourlyCost.bind(null, m.user_id)} className="flex items-end gap-1.5">
                      <Input
                        name="hourly_cost"
                        type="number"
                        min="0"
                        step="50"
                        defaultValue={m.hourly_cost ?? ''}
                        placeholder="not set"
                        className="w-24 py-1 text-xs"
                      />
                      <SubmitButton variant="ghost" size="sm" pendingText="…">Save</SubmitButton>
                    </form>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Custom period" />
            <form className="grid gap-3 px-5 py-4 sm:grid-cols-2" action="/profitability">
              <Field label="From">
                <Input name="from" type="date" defaultValue={from} required />
              </Field>
              <Field label="To">
                <Input name="to" type="date" defaultValue={to} required />
              </Field>
              <div className="sm:col-span-2">
                <SubmitButton size="sm" variant="secondary">Apply</SubmitButton>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
