import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPortalContext, PORTAL_STATUS_LABELS, type PortalContentRow } from '@/lib/portal';
import { portalComment, portalDecide } from '@/lib/actions/portal';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Card, CardHeader, Field, PageHeader, Select, Textarea } from '@/components/ui';
import { formatDate, formatDateTime } from '@/lib/utils';

interface ApprovalRow {
  id: string;
  round: number;
  decision: string;
  requested_at: string;
  decided_at: string | null;
  comment: string | null;
  on_behalf: boolean;
  decided_by_name: string | null;
}

export default async function PortalContentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getPortalContext();

  const { data: row } = await ctx.supabase.from('portal_content').select('*').eq('id', id).maybeSingle();
  if (!row) notFound();
  const item = row as unknown as PortalContentRow;

  const [{ data: approvalRows }, { data: commentRows }] = await Promise.all([
    ctx.supabase
      .from('portal_approvals')
      .select('id, round, decision, requested_at, decided_at, comment, on_behalf, decided_by_name')
      .eq('content_item_id', id)
      .order('round', { ascending: false }),
    ctx.supabase
      .from('portal_comments')
      .select('id, body, created_at, author_contact_id, contact_name')
      .eq('content_item_id', id)
      .order('created_at'),
  ]);

  const approvals = (approvalRows ?? []) as unknown as ApprovalRow[];
  const comments = (commentRows ?? []) as unknown as {
    id: string;
    body: string;
    created_at: string;
    author_contact_id: string | null;
    contact_name: string | null;
  }[];
  const pending = approvals.find((a) => a.decision === 'pending');
  const tone = PORTAL_STATUS_LABELS[item.status];

  return (
    <>
      <PageHeader
        back={{ href: '/portal', label: 'All content' }}
        title={item.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {tone && <Badge className={tone.tone}>{tone.label}</Badge>}
            {item.platforms?.length && <span>{item.platforms.join(' · ')}</span>}
            <span>
              {item.scheduled_date
                ? `· Goes out ${formatDate(item.scheduled_date, true)}${item.scheduled_time ? ` at ${item.scheduled_time.slice(0, 5)}` : ''}`
                : '· No date set yet'}
            </span>
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="The post" />
            <div className="space-y-4 px-5 py-4">
              <p className="whitespace-pre-wrap text-sm text-zinc-700">{item.caption || 'No caption yet.'}</p>
              {!!item.hashtags?.length && (
                <p className="text-sm text-brand-700">{item.hashtags.map((h) => `#${h}`).join(' ')}</p>
              )}
              {!!item.asset_urls?.length && (
                <div>
                  <p className="mb-1 text-xs font-medium text-zinc-500">Creatives</p>
                  <ul className="space-y-1">
                    {item.asset_urls.map((u) => (
                      <li key={u}>
                        <a href={u} target="_blank" rel="noreferrer" className="break-all text-sm text-brand-600 hover:underline">
                          {u}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {item.published_url && (
                <p className="text-sm">
                  Live:{' '}
                  <a href={item.published_url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                    {item.published_url}
                  </a>
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Conversation" subtitle={`${comments.length} message${comments.length === 1 ? '' : 's'}`} />
            <ul className="divide-y divide-zinc-100">
              {comments.map((c) => (
                <li key={c.id} className="px-5 py-3.5">
                  <p className="text-xs">
                    <span className="font-semibold text-ink">
                      {c.author_contact_id ? (c.contact_name ?? 'You') : ctx.agencyName}
                    </span>
                    <span className="ml-2 text-zinc-400">{formatDateTime(c.created_at)}</span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700">{c.body}</p>
                </li>
              ))}
              {comments.length === 0 && (
                <li className="px-5 py-5 text-sm text-zinc-500">No messages yet. Ask anything here.</li>
              )}
            </ul>
            <form action={portalComment.bind(null, item.id)} className="space-y-2 border-t border-zinc-100 px-5 py-4">
              <Textarea name="body" rows={2} required placeholder={`Message the ${ctx.agencyName} team…`} />
              <SubmitButton size="sm">Send</SubmitButton>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          {pending ? (
            <Card>
              <CardHeader title="Your decision" subtitle={`Sent to you on ${formatDate(pending.requested_at, true)}`} />
              <form action={portalDecide.bind(null, pending.id, item.id)} className="space-y-3 px-5 py-4">
                <Field label="Is this good to go?">
                  <Select name="decision" required defaultValue="approved">
                    <option value="approved">Approve it</option>
                    <option value="changes_requested">Request changes</option>
                  </Select>
                </Field>
                <Field label="Anything to add?" hint="Required if you're asking for changes">
                  <Textarea name="comment" rows={3} placeholder="e.g. Can the logo be bigger on the second frame?" />
                </Field>
                <SubmitButton className="w-full" pendingText="Sending…">
                  Send to {ctx.agencyName}
                </SubmitButton>
              </form>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Your decision" />
              <p className="px-5 py-4 text-sm text-zinc-500">
                {item.status === 'published'
                  ? 'This one is live — nothing left to do.'
                  : item.status === 'changes_requested'
                    ? 'The team is working on the changes you asked for. You’ll get this back to approve.'
                    : 'Nothing is waiting on you for this post.'}
              </p>
            </Card>
          )}

          <Card>
            <CardHeader title="History" subtitle="Every round on this post" />
            {approvals.length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-500">Not sent for approval yet.</p>
            ) : (
              <ol className="divide-y divide-zinc-100">
                {approvals.map((a) => (
                  <li key={a.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-ink">Round {a.round}</p>
                      <Badge
                        className={
                          a.decision === 'approved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : a.decision === 'changes_requested'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-brand-100 text-brand-800'
                        }
                      >
                        {a.decision === 'pending' ? 'Waiting on you' : a.decision === 'approved' ? 'Approved' : 'Changes requested'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-500">Sent {formatDateTime(a.requested_at)}</p>
                    {a.decided_at && (
                      <p className="text-[11px] text-zinc-500">
                        {a.decided_by_name ?? 'You'} replied {formatDateTime(a.decided_at)}
                        {a.on_behalf && <span className="text-zinc-400"> · recorded by the team</span>}
                      </p>
                    )}
                    {a.comment && <p className="mt-1.5 whitespace-pre-wrap text-sm text-zinc-700">“{a.comment}”</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <p className="px-1 text-xs text-zinc-400">
            Questions outside this post? Reply to your usual thread with {ctx.agencyName}, or{' '}
            <Link href="/portal" className="text-brand-600 hover:underline">
              see everything shared with you
            </Link>
            .
          </p>
        </div>
      </div>
    </>
  );
}
