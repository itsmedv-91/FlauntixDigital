import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, getTeam } from '@/lib/auth';
import { convertLead, deleteLead, updateLead } from '@/lib/actions/leads';
import { LEAD_STAGES } from '@/lib/constants';
import type { Lead } from '@/lib/types';
import { LeadForm } from '@/components/lead-form';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Card, CardHeader, Disclosure, PageHeader } from '@/components/ui';
import { cn, displayName, formatDate, formatINR, isOverdue } from '@/lib/utils';

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx.isStaff) notFound();

  const [{ data: lead }, team] = await Promise.all([
    ctx.supabase
      .from('leads')
      .select('*, owner:profiles(full_name, email)')
      .eq('id', id)
      .eq('agency_id', ctx.agencyId)
      .maybeSingle(),
    getTeam(),
  ]);
  if (!lead) notFound();
  const l = lead as Lead & { owner: { full_name: string | null; email: string | null } | null };
  const stage = LEAD_STAGES.find((s) => s.value === l.stage);
  const chase = isOverdue(l.next_follow_up) && l.stage !== 'won' && l.stage !== 'lost';

  const facts: [string, React.ReactNode][] = [
    ['Stage', <Badge key="s" className="bg-brand-100 text-brand-800">{stage?.label ?? l.stage}</Badge>],
    ['Estimated value', formatINR(l.estimated_value)],
    ['Source', l.source ?? '—'],
    ['Owner', displayName(l.owner)],
    [
      'Next follow-up',
      <span key="f" className={cn(chase && 'font-semibold text-coral-500')}>
        {chase ? 'Overdue · ' : ''}
        {formatDate(l.next_follow_up, true)}
      </span>,
    ],
    ['Added', formatDate(l.created_at, true)],
    ['Contact', l.contact_name ?? '—'],
    ['Email', l.email ? <a key="e" href={`mailto:${l.email}`} className="hover:text-brand-600">{l.email}</a> : '—'],
    ['Phone', l.phone ? <a key="p" href={`tel:${l.phone}`} className="hover:text-brand-600">{l.phone}</a> : '—'],
  ];
  if (l.stage === 'lost') facts.push(['Lost reason', l.lost_reason ?? '—']);

  return (
    <>
      <PageHeader
        back={{ href: '/leads', label: 'Leads & CRM' }}
        title={l.company}
        subtitle={[l.contact_name, l.source].filter(Boolean).join(' · ') || 'No contact details yet'}
        actions={
          ctx.isManager && !l.converted_client_id ? (
            <form action={convertLead.bind(null, l.id)}>
              <SubmitButton pendingText="Converting…" confirm={`Create a client from ${l.company}? This also opens a client chat channel.`}>
                Convert to client
              </SubmitButton>
            </form>
          ) : l.converted_client_id ? (
            <Link
              href={`/clients/${l.converted_client_id}`}
              className="text-sm font-medium text-brand-600 hover:underline"
            >
              View client →
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Lead details" />
          <dl className="grid gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-3">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium text-zinc-500">{label}</dt>
                <dd className="mt-0.5 text-sm text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {!!l.services_interested?.length && (
            <div className="border-t border-zinc-100 px-5 py-4">
              <p className="text-xs font-medium text-zinc-500">Services interested in</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {l.services_interested.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Notes" />
          <p className="whitespace-pre-wrap px-5 py-4 text-sm text-zinc-600">{l.notes || 'No notes yet.'}</p>
        </Card>
      </div>

      {ctx.isManager && (
        <div className="mt-5 space-y-3">
          <Disclosure summary="Edit lead">
            <LeadForm action={updateLead.bind(null, l.id)} team={team} lead={l} submitLabel="Save lead" />
            <form action={deleteLead.bind(null, l.id)} className="mt-4 border-t border-zinc-100 pt-4">
              <SubmitButton variant="danger" size="sm" confirm="Delete this lead for good?" pendingText="Deleting…">
                Delete lead
              </SubmitButton>
            </form>
          </Disclosure>
        </div>
      )}
    </>
  );
}
