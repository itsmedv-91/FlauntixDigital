import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/auth';
import {
  addInvoiceLine,
  addPayment,
  cancelInvoice,
  deleteInvoice,
  deleteInvoiceLine,
  deletePayment,
  issueInvoice,
  updateInvoice,
} from '@/lib/actions/invoices';
import { GST_RATES, GST_STATES, INVOICE_STATUSES, SAC_CODES } from '@/lib/gst';
import type { Invoice, InvoiceLine, InvoicePayment } from '@/lib/types';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Card, CardHeader, Disclosure, Field, Input, PageHeader, Select, Stat, Textarea } from '@/components/ui';
import { cn, formatDate, formatINR, todayIST } from '@/lib/utils';

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx.isManager) notFound();

  const { data: row } = await ctx.supabase
    .from('invoices')
    .select('*, client:clients(id, name, gstin, state_code, billing_address)')
    .eq('id', id)
    .eq('agency_id', ctx.agencyId)
    .maybeSingle();
  if (!row) notFound();

  const inv = row as unknown as Invoice & {
    client: { id: string; name: string; gstin: string | null; state_code: string | null; billing_address: string | null } | null;
  };

  const [{ data: lineRows }, { data: paymentRows }, { data: projects }, { data: agency }] = await Promise.all([
    ctx.supabase.from('invoice_lines').select('*').eq('invoice_id', id).order('position'),
    ctx.supabase.from('invoice_payments').select('*').eq('invoice_id', id).order('paid_on'),
    ctx.supabase.from('projects').select('id, name').eq('agency_id', ctx.agencyId).eq('client_id', inv.client_id).order('name'),
    ctx.supabase.from('agencies').select('default_sac, default_gst_rate, state_code, gstin').eq('id', ctx.agencyId).maybeSingle(),
  ]);

  const lines = (lineRows ?? []) as unknown as InvoiceLine[];
  const payments = (paymentRows ?? []) as unknown as InvoicePayment[];
  const paid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const balance = Number(inv.total) - paid;
  const st = INVOICE_STATUSES.find((s) => s.value === inv.status);
  const isDraft = inv.status === 'draft';
  const today = todayIST();

  return (
    <>
      <PageHeader
        back={{ href: '/invoices', label: 'Invoices' }}
        title={inv.number ?? 'Draft invoice'}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge className={st?.tone}>{st?.label}</Badge>
            {inv.client && (
              <Link href={`/clients/${inv.client.id}`} className="hover:text-brand-600">{inv.client.name}</Link>
            )}
            {inv.issue_date && <span>· {formatDate(inv.issue_date, true)}</span>}
            {inv.status !== 'draft' && (
              <Badge className="bg-zinc-100 text-zinc-600">{inv.is_interstate ? 'IGST (inter-state)' : 'CGST + SGST'}</Badge>
            )}
          </span>
        }
        actions={
          !isDraft && (
            <Link
              href={`/invoices/${inv.id}/print`}
              className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-ink hover:bg-zinc-50"
            >
              Print / PDF
            </Link>
          )
        }
      />

      {inv.status === 'cancelled' && (
        <p className="mb-5 rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm text-zinc-700">
          <span className="font-semibold">Cancelled</span>
          {inv.cancelled_at && ` on ${formatDate(inv.cancelled_at, true)}`}
          {inv.cancel_reason && ` — ${inv.cancel_reason}`}. The number stays reserved so the sequence remains consecutive.
        </p>
      )}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Taxable value" value={formatINR(Number(inv.taxable_total))} />
        <Stat
          label={inv.is_interstate ? 'IGST' : 'CGST + SGST'}
          value={formatINR(Number(inv.tax_total))}
          hint={inv.is_interstate ? undefined : `${formatINR(Number(inv.cgst_total))} + ${formatINR(Number(inv.sgst_total))}`}
        />
        <Stat label="Invoice total" value={formatINR(Number(inv.total))} hint={Number(inv.round_off) !== 0 ? `incl. round off ${Number(inv.round_off).toFixed(2)}` : undefined} />
        <Stat
          label={balance > 0 ? 'Balance due' : 'Settled'}
          value={formatINR(balance)}
          tone={balance > 0 && inv.due_date && inv.due_date < today && !isDraft ? 'warn' : undefined}
          hint={paid > 0 ? `${formatINR(paid)} received` : undefined}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Card className="overflow-x-auto">
            <CardHeader
              title="Line items"
              subtitle={isDraft ? 'Tax is recalculated by the database on every change' : `${lines.length} line${lines.length === 1 ? '' : 's'}`}
            />
            {lines.length === 0 ? (
              <p className="px-5 py-5 text-sm text-zinc-500">No lines yet. Add what you are billing for below.</p>
            ) : (
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500">
                    <th className="px-5 py-2.5 font-medium">Description</th>
                    <th className="px-2 py-2.5 font-medium">SAC</th>
                    <th className="px-2 py-2.5 text-right font-medium">Qty</th>
                    <th className="px-2 py-2.5 text-right font-medium">Rate</th>
                    <th className="px-2 py-2.5 text-right font-medium">Taxable</th>
                    <th className="px-2 py-2.5 text-right font-medium">GST</th>
                    <th className="px-2 py-2.5 text-right font-medium">Total</th>
                    {isDraft && <th className="px-5 py-2.5" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-5 py-2.5 text-ink">{l.description}</td>
                      <td className="px-2 py-2.5 font-mono text-xs text-zinc-500">{l.sac_code ?? '—'}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-zinc-600">{Number(l.quantity)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-zinc-600">
                        {formatINR(Number(l.unit_price))}
                        {Number(l.discount_pct) > 0 && <span className="block text-xs text-zinc-400">−{Number(l.discount_pct)}%</span>}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{formatINR(Number(l.taxable))}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-zinc-600">
                        {Number(l.gst_rate)}%
                        <span className="block text-xs text-zinc-400">
                          {formatINR(Number(l.cgst) + Number(l.sgst) + Number(l.igst))}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-right font-medium tabular-nums">{formatINR(Number(l.line_total))}</td>
                      {isDraft && (
                        <td className="px-5 py-2.5 text-right">
                          <form action={deleteInvoiceLine.bind(null, inv.id, l.id)}>
                            <button className="text-xs text-zinc-400 hover:text-red-600">Remove</button>
                          </form>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {isDraft && (
            <Disclosure summary="Add a line" open={lines.length === 0}>
              <form action={addInvoiceLine.bind(null, inv.id)} className="grid gap-4 sm:grid-cols-2">
                <Field label="Description" className="sm:col-span-2">
                  <Input name="description" required placeholder="e.g. Social media management — May 2026" />
                </Field>
                <Field label="SAC code" hint="The service classification printed on the invoice">
                  <Select name="sac_code" defaultValue={agency?.default_sac ?? '998361'}>
                    {SAC_CODES.map((s) => (
                      <option key={s.code} value={s.code}>{s.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="GST rate">
                  <Select name="gst_rate" defaultValue={String(agency?.default_gst_rate ?? 18)}>
                    {GST_RATES.map((r) => (
                      <option key={r} value={r}>{r}%</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Quantity">
                  <Input name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" />
                </Field>
                <Field label="Rate (₹)">
                  <Input name="unit_price" type="number" min="0" step="0.01" required placeholder="25000" />
                </Field>
                <Field label="Discount %">
                  <Input name="discount_pct" type="number" min="0" max="100" step="0.01" defaultValue="0" />
                </Field>
                {!!projects?.length && (
                  <Field label="Project" hint="Optional, for your own reporting">
                    <Select name="project_id" defaultValue="">
                      <option value="">Not linked</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </Select>
                  </Field>
                )}
                <div className="sm:col-span-2">
                  <SubmitButton>Add line</SubmitButton>
                </div>
              </form>
            </Disclosure>
          )}

          <Card>
            <CardHeader title="Payments received" subtitle={payments.length ? `${formatINR(paid)} in total` : 'Nothing recorded yet'} />
            {payments.length > 0 && (
              <ul className="divide-y divide-zinc-100">
                {payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                    <span className="w-28 font-medium tabular-nums text-ink">{formatINR(Number(p.amount))}</span>
                    <span className="min-w-0 flex-1 text-zinc-600">
                      {formatDate(p.paid_on, true)}
                      {p.method && ` · ${p.method}`}
                      {p.reference && <span className="block truncate text-xs text-zinc-400">{p.reference}</span>}
                    </span>
                    <form action={deletePayment.bind(null, inv.id, p.id)}>
                      <button className="text-xs text-zinc-400 hover:text-red-600">Remove</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            {inv.status !== 'draft' && inv.status !== 'cancelled' && (
              <form action={addPayment.bind(null, inv.id)} className="grid gap-3 border-t border-zinc-100 px-5 py-4 sm:grid-cols-2">
                <Field label="Amount received (₹)">
                  <Input name="amount" type="number" min="0.01" step="0.01" required defaultValue={balance > 0 ? balance.toFixed(2) : ''} />
                </Field>
                <Field label="Received on">
                  <Input name="paid_on" type="date" defaultValue={today} />
                </Field>
                <Field label="Method">
                  <Select name="method" defaultValue="NEFT / RTGS">
                    {['NEFT / RTGS', 'UPI', 'Cheque', 'Cash', 'Card', 'Other'].map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Reference" hint="UTR, cheque number…">
                  <Input name="reference" />
                </Field>
                <div className="sm:col-span-2">
                  <SubmitButton size="sm">Record payment</SubmitButton>
                </div>
              </form>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {isDraft ? (
            <Card>
              <CardHeader title="Issue this invoice" subtitle="This allocates the next number and locks the invoice" />
              <div className="space-y-3 px-5 py-4">
                <p className="text-xs text-zinc-500">
                  Once issued, the lines and totals cannot be edited — GST numbering has to stay consecutive, so a mistake
                  is fixed by cancelling and raising a new invoice.
                </p>
                <form action={issueInvoice.bind(null, inv.id)} className="space-y-3">
                  <Field label="Invoice date" hint="Decides the financial year of the number">
                    <Input name="issue_date" type="date" defaultValue={inv.issue_date ?? today} />
                  </Field>
                  <SubmitButton
                    className="w-full"
                    pendingText="Issuing…"
                    disabled={lines.length === 0}
                    confirm="Issue this invoice? It gets a permanent number and can no longer be edited."
                  >
                    Issue invoice
                  </SubmitButton>
                </form>
                {lines.length === 0 && <p className="text-xs text-zinc-400">Add at least one line first.</p>}
              </div>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Tax summary" />
              <dl className="space-y-1.5 px-5 py-4 text-sm">
                {[
                  ['Taxable value', formatINR(Number(inv.taxable_total))],
                  ...(inv.is_interstate
                    ? ([['IGST', formatINR(Number(inv.igst_total))]] as [string, string][])
                    : ([
                        ['CGST', formatINR(Number(inv.cgst_total))],
                        ['SGST', formatINR(Number(inv.sgst_total))],
                      ] as [string, string][])),
                  ['Round off', Number(inv.round_off).toFixed(2)],
                  ['Total', formatINR(Number(inv.total))],
                ].map(([label, value], i, arr) => (
                  <div key={label} className={cn('flex justify-between', i === arr.length - 1 && 'border-t border-zinc-100 pt-1.5 font-semibold text-ink')}>
                    <dt className="text-zinc-500">{label}</dt>
                    <dd className="tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">
                Place of supply: {inv.place_of_supply_name ?? '—'}
                {inv.place_of_supply_code ? ` (${inv.place_of_supply_code})` : ''}
                {inv.reverse_charge && <span className="mt-1 block">Tax payable on reverse charge.</span>}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Billed to" />
            <div className="space-y-1 px-5 py-4 text-sm">
              <p className="font-medium text-ink">{inv.recipient_name ?? inv.client?.name}</p>
              <p className="whitespace-pre-wrap text-zinc-600">
                {inv.recipient_address ?? inv.client?.billing_address ?? 'No billing address on file'}
              </p>
              <p className="font-mono text-xs text-zinc-500">
                GSTIN: {inv.recipient_gstin ?? inv.client?.gstin ?? 'unregistered'}
              </p>
              {isDraft && !(inv.client?.state_code) && (
                <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                  This client has no state set, so the place of supply is blank and issuing will be refused. Add it on the{' '}
                  <Link href={`/clients/${inv.client_id}?tab=edit`} className="underline">client record</Link>.
                </p>
              )}
            </div>
          </Card>

          {isDraft && (
            <Disclosure summary="Invoice details">
              <form action={updateInvoice.bind(null, inv.id)} className="space-y-3">
                <Field label="Invoice date">
                  <Input name="issue_date" type="date" defaultValue={inv.issue_date ?? ''} />
                </Field>
                <Field label="Payment due">
                  <Input name="due_date" type="date" defaultValue={inv.due_date ?? ''} />
                </Field>
                <Field label="Place of supply">
                  <Select name="place_of_supply_code" defaultValue={inv.place_of_supply_code ?? ''}>
                    <option value="">Not set</option>
                    {GST_STATES.map((s) => (
                      <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Notes">
                  <Textarea name="notes" rows={2} defaultValue={inv.notes ?? ''} />
                </Field>
                <Field label="Terms">
                  <Textarea name="terms" rows={2} defaultValue={inv.terms ?? ''} />
                </Field>
                <Field label="Bank details">
                  <Textarea name="bank_details" rows={2} defaultValue={inv.bank_details ?? ''} />
                </Field>
                <label className="flex items-center gap-2 text-sm text-zinc-700">
                  <input type="checkbox" name="reverse_charge" defaultChecked={inv.reverse_charge} /> Reverse charge
                </label>
                <SubmitButton size="sm">Save details</SubmitButton>
              </form>
              <form action={deleteInvoice.bind(null, inv.id)} className="mt-4 border-t border-zinc-100 pt-4">
                <SubmitButton variant="danger" size="sm" confirm="Delete this draft? It has no number yet, so nothing is lost." pendingText="Deleting…">
                  Delete draft
                </SubmitButton>
              </form>
            </Disclosure>
          )}

          {inv.status !== 'draft' && inv.status !== 'cancelled' && (
            <Disclosure summary="Cancel this invoice">
              <form action={cancelInvoice.bind(null, inv.id)} className="space-y-3">
                <p className="text-xs text-zinc-500">
                  Cancelling keeps the number reserved and the record intact, which is what GST requires. Remove any
                  recorded payments first.
                </p>
                <Field label="Reason">
                  <Input name="cancel_reason" required placeholder="e.g. Raised against the wrong client" />
                </Field>
                <SubmitButton variant="danger" size="sm" confirm="Cancel this invoice? This cannot be undone." pendingText="Cancelling…">
                  Cancel invoice
                </SubmitButton>
              </form>
            </Disclosure>
          )}
        </div>
      </div>
    </>
  );
}
