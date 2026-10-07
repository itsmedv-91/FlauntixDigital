import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/auth';
import { rupeesInWords, stateName } from '@/lib/gst';
import type { Invoice, InvoiceLine } from '@/lib/types';
import { formatDate, formatINR } from '@/lib/utils';

export const metadata = { title: 'Tax invoice' };

const money = (n: number) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/**
 * The invoice document itself, laid out to satisfy Rule 46 of the CGST Rules.
 * Print chrome is hidden with the `no-print` class (see app/globals.css).
 */
export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx.isManager) notFound();

  const { data: row } = await ctx.supabase
    .from('invoices')
    .select('*, client:clients(name, gstin, billing_address, state_code)')
    .eq('id', id)
    .eq('agency_id', ctx.agencyId)
    .maybeSingle();
  if (!row) notFound();

  const inv = row as unknown as Invoice & {
    client: { name: string; gstin: string | null; billing_address: string | null; state_code: string | null } | null;
  };
  if (inv.status === 'draft') {
    // A draft has no number, so there is no tax invoice to print yet.
    notFound();
  }

  const [{ data: lineRows }, { data: agency }] = await Promise.all([
    ctx.supabase.from('invoice_lines').select('*').eq('invoice_id', id).order('position'),
    ctx.supabase.from('agencies').select('name, billing_email, billing_phone, pan').eq('id', ctx.agencyId).maybeSingle(),
  ]);
  const lines = (lineRows ?? []) as unknown as InvoiceLine[];
  const inter = inv.is_interstate;
  const rates = [...new Set(lines.map((l) => Number(l.gst_rate)))];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/invoices/${inv.id}`} className="text-xs font-medium text-zinc-500 hover:text-brand-600">
          ← Back to the invoice
        </Link>
        <p className="text-xs text-zinc-500">
          Use your browser&apos;s Print dialog (Ctrl/Cmd+P) and choose &ldquo;Save as PDF&rdquo;.
        </p>
      </div>

      <article className="rounded-xl border border-zinc-300 bg-white p-8 text-[13px] leading-snug text-ink print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-300 pb-4">
          <div>
            <h1 className="text-lg font-bold">{inv.supplier_name ?? agency?.name}</h1>
            {inv.supplier_address && <p className="mt-1 whitespace-pre-wrap text-zinc-600">{inv.supplier_address}</p>}
            <p className="mt-1 text-zinc-600">
              {[agency?.billing_email, agency?.billing_phone].filter(Boolean).join(' · ')}
            </p>
            <p className="mt-1 font-mono text-xs">
              {inv.supplier_gstin && <>GSTIN: {inv.supplier_gstin}</>}
              {agency?.pan && <> · PAN: {agency.pan}</>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold uppercase tracking-wide">Tax Invoice</p>
            <p className="mt-1 text-zinc-600">
              <span className="font-semibold text-ink">{inv.number}</span>
            </p>
            <p className="text-zinc-600">Dated {formatDate(inv.issue_date, true)}</p>
            {inv.due_date && <p className="text-zinc-600">Due {formatDate(inv.due_date, true)}</p>}
            {inv.status === 'cancelled' && (
              <p className="mt-1 font-bold uppercase text-red-600">Cancelled</p>
            )}
          </div>
        </header>

        <section className="grid gap-6 border-b border-zinc-300 py-4 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Billed to</p>
            <p className="mt-1 font-semibold">{inv.recipient_name ?? inv.client?.name}</p>
            <p className="whitespace-pre-wrap text-zinc-600">
              {inv.recipient_address ?? inv.client?.billing_address ?? ''}
            </p>
            <p className="mt-1 font-mono text-xs">
              GSTIN: {inv.recipient_gstin ?? inv.client?.gstin ?? 'Unregistered'}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Place of supply</p>
            <p className="mt-1">
              {inv.place_of_supply_name ?? stateName(inv.place_of_supply_code) ?? '—'}
              {inv.place_of_supply_code ? ` (${inv.place_of_supply_code})` : ''}
            </p>
            <p className="mt-1 text-xs text-zinc-600">
              {inter ? 'Inter-state supply — IGST' : 'Intra-state supply — CGST + SGST'}
            </p>
            <p className="mt-1 text-xs text-zinc-600">
              Reverse charge: <span className="font-semibold">{inv.reverse_charge ? 'Yes' : 'No'}</span>
            </p>
          </div>
        </section>

        <table className="mt-4 w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b-2 border-zinc-400 text-left">
              <th className="py-2 pr-2 font-semibold">#</th>
              <th className="py-2 pr-2 font-semibold">Description of service</th>
              <th className="py-2 pr-2 font-semibold">SAC</th>
              <th className="py-2 pr-2 text-right font-semibold">Qty</th>
              <th className="py-2 pr-2 text-right font-semibold">Rate</th>
              <th className="py-2 pr-2 text-right font-semibold">Taxable</th>
              {inter ? (
                <>
                  <th className="py-2 pr-2 text-right font-semibold">IGST %</th>
                  <th className="py-2 pr-2 text-right font-semibold">IGST</th>
                </>
              ) : (
                <>
                  <th className="py-2 pr-2 text-right font-semibold">CGST</th>
                  <th className="py-2 pr-2 text-right font-semibold">SGST</th>
                </>
              )}
              <th className="py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id} className="border-b border-zinc-200 align-top">
                <td className="py-2 pr-2 text-zinc-500">{i + 1}</td>
                <td className="py-2 pr-2">{l.description}</td>
                <td className="py-2 pr-2 font-mono">{l.sac_code ?? '—'}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{Number(l.quantity)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {money(Number(l.unit_price))}
                  {Number(l.discount_pct) > 0 && <span className="block text-[10px] text-zinc-500">less {Number(l.discount_pct)}%</span>}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">{money(Number(l.taxable))}</td>
                {inter ? (
                  <>
                    <td className="py-2 pr-2 text-right tabular-nums">{Number(l.gst_rate)}%</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{money(Number(l.igst))}</td>
                  </>
                ) : (
                  <>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      <span className="block text-[10px] text-zinc-500">{Number(l.gst_rate) / 2}%</span>
                      {money(Number(l.cgst))}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      <span className="block text-[10px] text-zinc-500">{Number(l.gst_rate) / 2}%</span>
                      {money(Number(l.sgst))}
                    </td>
                  </>
                )}
                <td className="py-2 text-right font-medium tabular-nums">{money(Number(l.line_total))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="mt-4 flex flex-wrap justify-end gap-6">
          <dl className="min-w-[260px] space-y-1">
            <div className="flex justify-between">
              <dt className="text-zinc-600">Taxable value</dt>
              <dd className="tabular-nums">{money(Number(inv.taxable_total))}</dd>
            </div>
            {inter ? (
              <div className="flex justify-between">
                <dt className="text-zinc-600">IGST</dt>
                <dd className="tabular-nums">{money(Number(inv.igst_total))}</dd>
              </div>
            ) : (
              <>
                <div className="flex justify-between">
                  <dt className="text-zinc-600">CGST</dt>
                  <dd className="tabular-nums">{money(Number(inv.cgst_total))}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-600">SGST</dt>
                  <dd className="tabular-nums">{money(Number(inv.sgst_total))}</dd>
                </div>
              </>
            )}
            {Number(inv.round_off) !== 0 && (
              <div className="flex justify-between">
                <dt className="text-zinc-600">Round off</dt>
                <dd className="tabular-nums">{money(Number(inv.round_off))}</dd>
              </div>
            )}
            <div className="flex justify-between border-t-2 border-zinc-400 pt-1.5 text-base font-bold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatINR(Number(inv.total))}</dd>
            </div>
          </dl>
        </section>

        <p className="mt-3 border-t border-zinc-200 pt-3 text-[12px]">
          <span className="text-zinc-500">Amount in words: </span>
          <span className="font-medium">{rupeesInWords(Number(inv.total))}</span>
        </p>

        {rates.length > 0 && (
          <p className="mt-1 text-[11px] text-zinc-500">
            GST charged at {rates.sort((a, b) => a - b).map((r) => `${r}%`).join(', ')}
            {inter ? ' as IGST' : ' split equally between CGST and SGST'}.
          </p>
        )}

        <section className="mt-6 grid gap-6 border-t border-zinc-300 pt-4 sm:grid-cols-2">
          <div className="space-y-3">
            {inv.bank_details && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Payment details</p>
                <p className="mt-0.5 whitespace-pre-wrap text-zinc-700">{inv.bank_details}</p>
              </div>
            )}
            {inv.notes && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Notes</p>
                <p className="mt-0.5 whitespace-pre-wrap text-zinc-700">{inv.notes}</p>
              </div>
            )}
            {inv.terms && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Terms</p>
                <p className="mt-0.5 whitespace-pre-wrap text-zinc-700">{inv.terms}</p>
              </div>
            )}
          </div>
          <div className="flex flex-col justify-between sm:items-end">
            <p className="text-[11px] text-zinc-500">
              {inv.reverse_charge
                ? 'Tax payable on reverse charge by the recipient.'
                : 'Tax payable by the supplier.'}
            </p>
            <div className="mt-10 text-center sm:text-right">
              <p className="border-t border-zinc-400 pt-1.5 text-xs">
                For <span className="font-semibold">{inv.supplier_name ?? agency?.name}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-500">Authorised signatory</p>
            </div>
          </div>
        </section>

        <p className="mt-4 text-center text-[10px] text-zinc-400">
          This is a computer-generated tax invoice.
        </p>
      </article>
    </div>
  );
}
