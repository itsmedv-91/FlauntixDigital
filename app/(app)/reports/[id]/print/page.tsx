import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/auth';
import type { ClientReport } from '@/lib/types';
import { formatDate, formatINR } from '@/lib/utils';

export const metadata = { title: 'Client report' };

/** The report as the client receives it. Print chrome hides via `no-print`. */
export default async function ReportPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx.isStaff) notFound();

  const [{ data }, { data: agency }] = await Promise.all([
    ctx.supabase
      .from('client_reports')
      .select('*, client:clients(name)')
      .eq('id', id)
      .eq('agency_id', ctx.agencyId)
      .maybeSingle(),
    ctx.supabase.from('agencies').select('name, legal_name, billing_email').eq('id', ctx.agencyId).maybeSingle(),
  ]);
  if (!data) notFound();

  const report = data as unknown as ClientReport & { client: { name: string } | null };
  const snap = report.snapshot ?? {};
  const counts = snap.counts;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/reports/${report.id}`} className="text-xs font-medium text-zinc-500 hover:text-brand-600">
          ← Back to the report
        </Link>
        <p className="text-xs text-zinc-500">Print (Ctrl/Cmd+P) and choose &ldquo;Save as PDF&rdquo;.</p>
      </div>

      <article className="rounded-xl border border-zinc-300 bg-white p-8 text-[13px] leading-relaxed text-ink print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-300 pb-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              {agency?.legal_name ?? agency?.name}
            </p>
            <h1 className="mt-1 text-xl font-bold">{report.title}</h1>
            <p className="mt-1 text-zinc-600">
              {report.client?.name} · {formatDate(report.period_start)} – {formatDate(report.period_end, true)}
            </p>
          </div>
          {report.sent_at && <p className="text-xs text-zinc-500">Issued {formatDate(report.sent_at, true)}</p>}
        </header>

        {report.summary && (
          <section className="mt-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Summary</h2>
            <p className="mt-1.5 whitespace-pre-wrap">{report.summary}</p>
          </section>
        )}

        <section className="mt-5 grid grid-cols-2 gap-4 border-y border-zinc-200 py-4 sm:grid-cols-4">
          {[
            ['Published', String(counts?.published ?? 0)],
            ['Tasks delivered', String(counts?.tasks_done ?? 0)],
            ['Approval rounds', String(counts?.approval_rounds ?? 0)],
            ['Ad spend', formatINR(Number(snap.ad_spend ?? 0))],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
              <p className="mt-0.5 text-lg font-semibold">{value}</p>
            </div>
          ))}
        </section>

        {!!snap.published?.length && (
          <section className="mt-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">What went live</h2>
            <table className="mt-2 w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-zinc-300 text-left">
                  <th className="py-1.5 pr-2 font-semibold">Date</th>
                  <th className="py-1.5 pr-2 font-semibold">Post</th>
                  <th className="py-1.5 pr-2 font-semibold">Where</th>
                  <th className="py-1.5 font-semibold">Link</th>
                </tr>
              </thead>
              <tbody>
                {snap.published.map((p, i) => (
                  <tr key={`${p.title}-${i}`} className="border-b border-zinc-100 align-top">
                    <td className="py-1.5 pr-2 whitespace-nowrap">{formatDate(p.date)}</td>
                    <td className="py-1.5 pr-2">{p.title}</td>
                    <td className="py-1.5 pr-2">{p.platforms?.join(', ') ?? '—'}</td>
                    <td className="py-1.5 break-all">
                      {p.url ? (
                        <a href={p.url} className="text-brand-700 underline">{p.url.replace(/^https?:\/\//, '')}</a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {!!snap.upcoming?.length && (
          <section className="mt-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Coming up</h2>
            <ul className="mt-2 space-y-1">
              {snap.upcoming.map((p, i) => (
                <li key={`${p.title}-${i}`} className="text-[12px]">
                  <span className="font-medium">{formatDate(p.date)}</span> — {p.title}
                  {p.platforms?.length ? ` (${p.platforms.join(', ')})` : ''}
                </li>
              ))}
            </ul>
          </section>
        )}

        {!!snap.awaiting_you?.length && (
          <section className="mt-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Waiting on your approval</h2>
            <ul className="mt-2 space-y-1">
              {snap.awaiting_you.map((p, i) => (
                <li key={`${p.title}-${i}`} className="text-[12px]">
                  {p.title} <span className="text-zinc-500">— sent {formatDate(p.since)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {report.next_steps && (
          <section className="mt-5 border-t border-zinc-200 pt-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Next steps</h2>
            <p className="mt-1.5 whitespace-pre-wrap">{report.next_steps}</p>
          </section>
        )}

        <footer className="mt-8 border-t border-zinc-200 pt-3 text-center text-[10px] text-zinc-400">
          {agency?.legal_name ?? agency?.name}
          {agency?.billing_email ? ` · ${agency.billing_email}` : ''}
        </footer>
      </article>
    </div>
  );
}
