import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/auth';
import { createInvoice } from '@/lib/actions/invoices';
import { GST_STATES, INVOICE_STATUSES, financialYear } from '@/lib/gst';
import type { Invoice } from '@/lib/types';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Card, Disclosure, EmptyState, Field, Input, PageHeader, Select, Stat, Textarea } from '@/components/ui';
import { addDays, cn, formatDate, formatINR, todayIST } from '@/lib/utils';

export const metadata = { title: 'Invoices' };

type Row = Invoice & {
  client: { id: string; name: string } | null;
  invoice_payments: { amount: number }[];
};

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; client?: string; fy?: string; new?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await getContext();
  // Billing is managers and above, matching the RLS policy.
  if (!ctx.isManager) notFound();

  const today = todayIST();
  const thisFy = financialYear(today);

  let q = ctx.supabase
    .from('invoices')
    .select('*, client:clients(id, name), invoice_payments(amount)')
    .eq('agency_id', ctx.agencyId);
  if (sp.status) q = q.eq('status', sp.status);
  if (sp.client) q = q.eq('client_id', sp.client);
  if (sp.fy) q = q.eq('fy', sp.fy);

  const [{ data, error }, { data: clients }, { data: agency }] = await Promise.all([
    q.order('issue_date', { ascending: false, nullsFirst: true }).order('number', { ascending: false }).limit(500),
    ctx.supabase.from('clients').select('id, name, state_code').eq('agency_id', ctx.agencyId).order('name'),
    ctx.supabase.from('agencies').select('state_code, gstin, invoice_prefix').eq('id', ctx.agencyId).maybeSingle(),
  ]);

  const rows = (data ?? []) as unknown as Row[];
  const paidOf = (r: Row) => r.invoice_payments.reduce((s, p) => s + Number(p.amount), 0);
  const live = rows.filter((r) => r.status !== 'draft' && r.status !== 'cancelled');
  const outstanding = live.reduce((s, r) => s + (Number(r.total) - paidOf(r)), 0);
  const overdue = live.filter((r) => Number(r.total) - paidOf(r) > 0 && r.due_date && r.due_date < today);
  const billedThisFy = rows
    .filter((r) => r.fy === thisFy && r.status !== 'cancelled' && r.status !== 'draft')
    .reduce((s, r) => s + Number(r.taxable_total), 0);

  const fys = [...new Set(rows.map((r) => r.fy).filter(Boolean))] as string[];
  const notConfigured = !agency?.state_code;

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle={`${rows.length} invoice${rows.length === 1 ? '' : 's'} · FY ${thisFy}`}
      />

      {notConfigured && (
        <p className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Set your agency&apos;s GSTIN, state and address in{' '}
          <Link href="/settings" className="font-medium underline">Settings</Link> before issuing invoices — they are
          printed on every one, and issuing is blocked without the state.
        </p>
      )}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Outstanding" value={formatINR(outstanding)} hint="Issued, not yet paid" />
        <Stat label="Overdue" value={overdue.length} tone={overdue.length ? 'warn' : undefined}
              hint={overdue.length ? formatINR(overdue.reduce((s, r) => s + (Number(r.total) - paidOf(r)), 0)) : undefined} />
        <Stat label={`Billed FY ${thisFy}`} value={formatINR(billedThisFy)} hint="Taxable value" />
        <Stat label="Drafts" value={rows.filter((r) => r.status === 'draft').length} />
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load invoices: {error.message}
        </p>
      )}

      <div className="mb-5 space-y-4">
        <Disclosure summary="New invoice" open={sp.new === '1'}>
          <form action={createInvoice} className="grid gap-4 sm:grid-cols-2">
            <Field label="Client">
              <Select name="client_id" required defaultValue={sp.client ?? ''}>
                <option value="">Choose a client…</option>
                {(clients ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Place of supply" hint="Defaults to the client's state; decides CGST+SGST vs IGST">
              <Select name="place_of_supply_code" defaultValue="">
                <option value="">Use the client&apos;s state</option>
                {GST_STATES.map((s) => (
                  <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Invoice date">
              <Input name="issue_date" type="date" defaultValue={today} />
            </Field>
            <Field label="Payment due">
              <Input name="due_date" type="date" defaultValue={addDays(today, 15)} />
            </Field>
            <Field label="Notes on the invoice" className="sm:col-span-2">
              <Textarea name="notes" rows={2} placeholder="e.g. Retainer for May 2026" />
            </Field>
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" name="reverse_charge" /> Tax payable on reverse charge
            </label>
            <div className="sm:col-span-2">
              <SubmitButton pendingText="Creating…">Create draft</SubmitButton>
              <p className="mt-2 text-xs text-zinc-500">
                You add the line items next. Nothing is numbered until you press Issue.
              </p>
            </div>
          </form>
        </Disclosure>

        <form className="flex flex-wrap items-center gap-2" action="/invoices">
          <Select name="status" defaultValue={sp.status ?? ''} className="w-auto">
            <option value="">Any status</option>
            {INVOICE_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
          <Select name="client" defaultValue={sp.client ?? ''} className="w-auto">
            <option value="">All clients</option>
            {(clients ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          {fys.length > 1 && (
            <Select name="fy" defaultValue={sp.fy ?? ''} className="w-auto">
              <option value="">All years</option>
              {fys.sort().reverse().map((f) => (
                <option key={f} value={f}>FY {f}</option>
              ))}
            </Select>
          )}
          <button className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-ink ring-1 ring-zinc-200 hover:bg-zinc-50">Apply</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No invoices yet" body="Create a draft above, add what you are billing for, then issue it." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500">
                <th className="px-5 py-3 font-medium">Number</th>
                <th className="px-3 py-3 font-medium">Client</th>
                <th className="px-3 py-3 font-medium">Date</th>
                <th className="px-3 py-3 font-medium">Due</th>
                <th className="px-3 py-3 text-right font-medium">Total</th>
                <th className="px-3 py-3 text-right font-medium">Balance</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((r) => {
                const st = INVOICE_STATUSES.find((s) => s.value === r.status);
                const balance = Number(r.total) - paidOf(r);
                const late = balance > 0 && r.due_date && r.due_date < today && r.status !== 'draft' && r.status !== 'cancelled';
                return (
                  <tr key={r.id} className="hover:bg-zinc-50">
                    <td className="px-5 py-3">
                      <Link href={`/invoices/${r.id}`} className="font-medium text-ink hover:text-brand-600">
                        {r.number ?? 'Draft'}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-zinc-600">{r.client?.name ?? '—'}</td>
                    <td className="px-3 py-3 text-zinc-600">{formatDate(r.issue_date)}</td>
                    <td className={cn('px-3 py-3', late ? 'font-semibold text-coral-500' : 'text-zinc-600')}>
                      {formatDate(r.due_date)}{late && ' · overdue'}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatINR(Number(r.total))}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-zinc-600">
                      {r.status === 'cancelled' ? '—' : formatINR(balance)}
                    </td>
                    <td className="px-5 py-3">
                      <Badge className={st?.tone}>{st?.label}</Badge>
                      {r.is_interstate && r.status !== 'draft' && (
                        <Badge className="ml-1.5 bg-zinc-100 text-zinc-600">IGST</Badge>
                      )}
                    </td>
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
