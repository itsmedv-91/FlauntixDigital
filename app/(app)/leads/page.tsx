import { notFound } from 'next/navigation';
import { getContext, getTeam } from '@/lib/auth';
import { createLead } from '@/lib/actions/leads';
import { LeadBoard, type BoardLead } from '@/components/lead-board';
import { LeadForm } from '@/components/lead-form';
import { Disclosure, EmptyState, PageHeader, Stat } from '@/components/ui';
import { formatINR, isOverdue } from '@/lib/utils';

export const metadata = { title: 'Leads & CRM' };

const LEAD_SELECT =
  'id, company, contact_name, source, estimated_value, next_follow_up, stage, owner:profiles(id, full_name, email, avatar_url, job_title, skills)';

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.isStaff) notFound();
  const team = await getTeam();

  const { data } = await ctx.supabase
    .from('leads')
    .select(LEAD_SELECT)
    .eq('agency_id', ctx.agencyId)
    .order('next_follow_up', { ascending: true, nullsFirst: false })
    .limit(500);

  const leads = (data ?? []) as unknown as BoardLead[];
  const open = leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost');
  const pipeline = open.reduce((s, l) => s + (l.estimated_value ?? 0), 0);
  const won = leads.filter((l) => l.stage === 'won');
  const chase = open.filter((l) => isOverdue(l.next_follow_up)).length;

  return (
    <>
      <PageHeader
        title="Leads & CRM"
        subtitle={ctx.isManager ? 'Drag a lead to move it through the pipeline' : 'Read-only — managers can edit the pipeline'}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open leads" value={open.length} />
        <Stat label="Pipeline value" value={formatINR(pipeline)} hint="Open stages only" />
        <Stat label="Won" value={won.length} hint={formatINR(won.reduce((s, l) => s + (l.estimated_value ?? 0), 0))} />
        <Stat label="Follow-ups overdue" value={chase} tone={chase ? 'warn' : undefined} />
      </div>

      {ctx.isManager && (
        <div className="mb-5">
          <Disclosure summary="New lead" open={sp.new === '1'}>
            <LeadForm action={createLead} team={team} defaultOwnerId={ctx.user.id} />
          </Disclosure>
        </div>
      )}

      {leads.length === 0 ? (
        <EmptyState
          title="No leads yet"
          body={ctx.isManager ? 'Add your first enquiry above and drag it along as it progresses.' : 'Leads added by managers will show up here.'}
        />
      ) : (
        <LeadBoard leads={leads} canDrag={ctx.isManager} />
      )}
    </>
  );
}
