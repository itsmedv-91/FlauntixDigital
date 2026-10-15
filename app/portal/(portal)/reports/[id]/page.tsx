import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPortalContext } from '@/lib/portal';
import type { ReportSnapshot } from '@/lib/types';
import { Card, CardHeader, PageHeader, Stat } from '@/components/ui';
import { formatDate, formatINR } from '@/lib/utils';

/** The client's own view of a sent report, read from the portal_reports view. */
export default async function PortalReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getPortalContext();

  const { data } = await ctx.supabase.from('portal_reports').select('*').eq('id', id).maybeSingle();
  if (!data) notFound();

  const report = data as unknown as {
    title: string;
    client_name: string;
    period_start: string;
    period_end: string;
    summary: string | null;
    next_steps: string | null;
    snapshot: ReportSnapshot;
    sent_at: string;
  };
  const snap = report.snapshot ?? {};
  const counts = snap.counts;

  return (
    <>
      <PageHeader
        back={{ href: '/portal', label: 'All content' }}
        title={report.title}
        subtitle={`${formatDate(report.period_start)} – ${formatDate(report.period_end, true)} · from ${ctx.agencyName}`}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Published" value={counts?.published ?? 0} />
        <Stat label="Pieces delivered" value={counts?.tasks_done ?? 0} />
        <Stat label="Approval rounds" value={counts?.approval_rounds ?? 0} />
        <Stat label="Ad spend" value={formatINR(Number(snap.ad_spend ?? 0))} />
      </div>

      <div className="space-y-6">
        {report.summary && (
          <Card>
            <CardHeader title="Summary" />
            <p className="whitespace-pre-wrap px-5 py-4 text-sm text-zinc-700">{report.summary}</p>
          </Card>
        )}

        {!!snap.published?.length && (
          <Card>
            <CardHeader title="What went live" subtitle={`${snap.published.length} posts`} />
            <ul className="divide-y divide-zinc-100">
              {snap.published.map((p, i) => (
                <li key={`${p.title}-${i}`} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{p.title}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {[p.platforms?.join(', '), formatDate(p.date)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {p.url && (
                    <a href={p.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-600 hover:underline">
                      View
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {!!snap.upcoming?.length && (
          <Card>
            <CardHeader title="Coming up" />
            <ul className="divide-y divide-zinc-100">
              {snap.upcoming.map((p, i) => (
                <li key={`${p.title}-${i}`} className="px-5 py-3 text-sm">
                  <span className="font-medium text-ink">{p.title}</span>
                  <span className="ml-2 text-xs text-zinc-500">{formatDate(p.date)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {!!snap.awaiting_you?.length && (
          <Card className="border-brand-300/70">
            <CardHeader title="Waiting on you" subtitle="Approve these and they move into the schedule" />
            <ul className="divide-y divide-zinc-100">
              {snap.awaiting_you.map((p, i) => (
                <li key={`${p.title}-${i}`} className="px-5 py-3 text-sm">
                  <span className="font-medium text-ink">{p.title}</span>
                  <span className="ml-2 text-xs text-zinc-500">sent {formatDate(p.since)}</span>
                </li>
              ))}
            </ul>
            <p className="border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">
              <Link href="/portal" className="text-brand-600 hover:underline">Open your content list</Link> to approve them.
            </p>
          </Card>
        )}

        {report.next_steps && (
          <Card>
            <CardHeader title="Next steps" />
            <p className="whitespace-pre-wrap px-5 py-4 text-sm text-zinc-700">{report.next_steps}</p>
          </Card>
        )}
      </div>
    </>
  );
}
