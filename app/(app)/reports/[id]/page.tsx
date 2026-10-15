import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/auth';
import { deleteReport, rebuildReport, sendReport, updateReport } from '@/lib/actions/reports';
import type { ClientReport } from '@/lib/types';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Card, CardHeader, Field, Input, PageHeader, Stat, Textarea } from '@/components/ui';
import { formatDate, formatDateTime, formatINR } from '@/lib/utils';

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx.isStaff) notFound();

  const { data } = await ctx.supabase
    .from('client_reports')
    .select('*, client:clients(id, name)')
    .eq('id', id)
    .eq('agency_id', ctx.agencyId)
    .maybeSingle();
  if (!data) notFound();

  const report = data as unknown as ClientReport & { client: { id: string; name: string } | null };
  const snap = report.snapshot ?? {};
  const counts = snap.counts;
  const isDraft = report.status === 'draft';

  return (
    <>
      <PageHeader
        back={{ href: '/reports', label: 'Client reports' }}
        title={report.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge className={isDraft ? 'bg-zinc-100 text-zinc-700' : 'bg-emerald-100 text-emerald-800'}>
              {isDraft ? 'Draft' : `Sent ${formatDateTime(report.sent_at)}`}
            </Badge>
            {report.client && (
              <Link href={`/clients/${report.client.id}`} className="hover:text-brand-600">{report.client.name}</Link>
            )}
            <span>· {formatDate(report.period_start)} – {formatDate(report.period_end, true)}</span>
            {report.built_at && <span className="text-xs text-zinc-400">figures built {formatDateTime(report.built_at)}</span>}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/reports/${report.id}/print`}
              className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-ink hover:bg-zinc-50"
            >
              Print / PDF
            </Link>
            {isDraft && (
              <form action={rebuildReport.bind(null, report.id)}>
                <SubmitButton variant="secondary" pendingText="Rebuilding…">Refresh figures</SubmitButton>
              </form>
            )}
            {isDraft && ctx.isManager && (
              <form action={sendReport.bind(null, report.id)}>
                <SubmitButton
                  pendingText="Sending…"
                  confirm="Send this report? The figures freeze and the client can see it in their portal."
                >
                  Send to client
                </SubmitButton>
              </form>
            )}
          </div>
        }
      />

      {!isDraft && (
        <p className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          This report is sent, so its figures are frozen — it is the record of what the client was told. Create a new
          report for the next period rather than editing this one.
        </p>
      )}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Published" value={counts?.published ?? 0} hint="In this period" />
        <Stat label="Tasks delivered" value={counts?.tasks_done ?? 0} />
        <Stat label="Approval rounds" value={counts?.approval_rounds ?? 0} hint={`${counts?.changes_requested ?? 0} asked for changes`} />
        <Stat label="Ad spend" value={formatINR(Number(snap.ad_spend ?? 0))} hint="Rebilled to the client" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Went live" subtitle={`${snap.published?.length ?? 0} posts`} />
            {snap.published?.length ? (
              <ul className="divide-y divide-zinc-100">
                {snap.published.map((p, i) => (
                  <li key={`${p.title}-${i}`} className="px-5 py-3 text-sm">
                    <p className="font-medium text-ink">{p.title}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {[p.platforms?.join(', '), p.format, formatDate(p.date)].filter(Boolean).join(' · ')}
                      {p.url && (
                        <>
                          {' · '}
                          <a href={p.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                            view
                          </a>
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-zinc-500">Nothing published in this period.</p>
            )}
          </Card>

          <Card>
            <CardHeader title="Coming up" subtitle="Approved or scheduled after this period" />
            {snap.upcoming?.length ? (
              <ul className="divide-y divide-zinc-100">
                {snap.upcoming.map((p, i) => (
                  <li key={`${p.title}-${i}`} className="px-5 py-3 text-sm">
                    <p className="font-medium text-ink">{p.title}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {[p.platforms?.join(', '), formatDate(p.date)].filter(Boolean).join(' · ')}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-zinc-500">Nothing scheduled beyond this period yet.</p>
            )}
          </Card>

          {!!snap.awaiting_you?.length && (
            <Card className="border-amber-300/70">
              <CardHeader title="Waiting on the client" subtitle="Worth naming in the summary" />
              <ul className="divide-y divide-zinc-100">
                {snap.awaiting_you.map((p, i) => (
                  <li key={`${p.title}-${i}`} className="px-5 py-3 text-sm">
                    <p className="font-medium text-ink">{p.title}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">sent {formatDate(p.since)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Your commentary"
              subtitle={isDraft ? 'The figures are not the report — this is' : 'As sent'}
            />
            {isDraft ? (
              <form action={updateReport.bind(null, report.id)} className="space-y-3 px-5 py-4">
                <Field label="Title">
                  <Input name="title" defaultValue={report.title} required />
                </Field>
                <Field label="Summary" hint="What actually happened, in your words">
                  <Textarea name="summary" rows={6} defaultValue={report.summary ?? ''} placeholder="Reach was up 40% on April, driven by the two reels…" />
                </Field>
                <Field label="Next steps">
                  <Textarea name="next_steps" rows={4} defaultValue={report.next_steps ?? ''} placeholder="In June we'll…" />
                </Field>
                <SubmitButton>Save commentary</SubmitButton>
              </form>
            ) : (
              <div className="space-y-3 px-5 py-4 text-sm">
                <p className="whitespace-pre-wrap text-zinc-700">{report.summary || 'No summary was written.'}</p>
                {report.next_steps && (
                  <div className="border-t border-zinc-100 pt-3">
                    <p className="text-xs font-medium text-zinc-500">Next steps</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-zinc-700">{report.next_steps}</p>
                  </div>
                )}
              </div>
            )}
          </Card>

          {isDraft && ctx.isManager && (
            <Card>
              <CardHeader title="Delete this draft" />
              <form action={deleteReport.bind(null, report.id)} className="px-5 py-4">
                <SubmitButton variant="danger" size="sm" confirm="Delete this draft report?" pendingText="Deleting…">
                  Delete draft
                </SubmitButton>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
