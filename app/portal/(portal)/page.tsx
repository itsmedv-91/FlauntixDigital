import Link from 'next/link';
import { getPortalContext, PORTAL_STATUS_LABELS, type PortalContentRow } from '@/lib/portal';
import { Badge, Card, CardHeader, EmptyState, Stat } from '@/components/ui';
import { formatDate, todayIST } from '@/lib/utils';

export const metadata = { title: 'Your content' };

function Row({ item, cta }: { item: PortalContentRow; cta?: string }) {
  const tone = PORTAL_STATUS_LABELS[item.status];
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3.5">
      <Link href={`/portal/content/${item.id}`} className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink hover:text-brand-600">{item.title}</span>
        <span className="mt-0.5 block truncate text-xs text-zinc-500">
          {[
            item.client_name,
            item.platforms?.length ? item.platforms.join(', ') : null,
            item.scheduled_date ? `goes out ${formatDate(item.scheduled_date)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </Link>
      {tone && <Badge className={tone.tone}>{tone.label}</Badge>}
      {cta && (
        <Link
          href={`/portal/content/${item.id}`}
          className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600"
        >
          {cta}
        </Link>
      )}
    </li>
  );
}

export default async function PortalHome() {
  const ctx = await getPortalContext();

  const [{ data: contentRows }, { data: pendingRows }] = await Promise.all([
    ctx.supabase.from('portal_content').select('*').order('scheduled_date', { ascending: true, nullsFirst: false }),
    ctx.supabase.from('portal_approvals').select('id, content_item_id, requested_at').eq('decision', 'pending'),
  ]);

  const items = (contentRows ?? []) as unknown as PortalContentRow[];
  const pending = new Set(((pendingRows ?? []) as { content_item_id: string }[]).map((p) => p.content_item_id));
  const today = todayIST();

  const needsYou = items.filter((i) => i.status === 'client_approval');
  const withTeam = items.filter((i) => i.status === 'changes_requested');
  const upcoming = items.filter(
    (i) => (i.status === 'approved' || i.status === 'scheduled') && (!i.scheduled_date || i.scheduled_date >= today),
  );
  const published = items
    .filter((i) => i.status === 'published')
    .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
    .slice(0, 10);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {needsYou.length ? `${needsYou.length} ${needsYou.length === 1 ? 'post needs' : 'posts need'} your approval` : 'You’re all caught up'}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {needsYou.length
            ? 'Have a look and either approve it or tell the team what to change.'
            : 'Nothing is waiting on you right now. Here’s what’s coming up.'}
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Needs your approval" value={needsYou.length} tone={needsYou.length ? 'warn' : undefined} />
        <Stat label="Being changed" value={withTeam.length} hint="Back with the team" />
        <Stat label="Coming up" value={upcoming.length} hint="Approved or scheduled" />
        <Stat label="Published" value={items.filter((i) => i.status === 'published').length} />
      </div>

      <div className="space-y-6">
        {needsYou.length > 0 && (
          <Card>
            <CardHeader title="Waiting on you" subtitle="Longest wait first" />
            <ul className="divide-y divide-zinc-100">
              {[...needsYou]
                .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
                .map((i) => (
                  <Row key={i.id} item={i} cta={pending.has(i.id) ? 'Review' : undefined} />
                ))}
            </ul>
          </Card>
        )}

        {withTeam.length > 0 && (
          <Card>
            <CardHeader title="Changes you asked for" subtitle="The team is working on these" />
            <ul className="divide-y divide-zinc-100">
              {withTeam.map((i) => (
                <Row key={i.id} item={i} />
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader title="Coming up" subtitle="Approved and scheduled" />
          {upcoming.length ? (
            <ul className="divide-y divide-zinc-100">
              {upcoming.map((i) => (
                <Row key={i.id} item={i} />
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-sm text-zinc-500">Nothing scheduled yet.</p>
          )}
        </Card>

        {published.length > 0 && (
          <Card>
            <CardHeader title="Recently published" subtitle="Newest first" />
            <ul className="divide-y divide-zinc-100">
              {published.map((i) => (
                <Row key={i.id} item={i} />
              ))}
            </ul>
          </Card>
        )}

        {items.length === 0 && (
          <EmptyState
            title="Nothing shared with you yet"
            body={`When ${ctx.agencyName} sends content over for approval, it will show up here.`}
          />
        )}
      </div>
    </>
  );
}
