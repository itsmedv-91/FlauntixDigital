import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, getTeam } from '@/lib/auth';
import {
  addContentComment,
  deleteContent,
  duplicateContent,
  markPublished,
  recordDecision,
  requestApproval,
  updateContent,
} from '@/lib/actions/content';
import { CONTENT_FORMATS, CONTENT_STATUSES } from '@/lib/constants';
import type { ContentApproval, ContentItem } from '@/lib/types';
import { ContentForm } from '@/components/content-form';
import { SubmitButton } from '@/components/submit-button';
import { Avatar, Badge, Card, CardHeader, Disclosure, Field, Input, PageHeader, Select, Textarea } from '@/components/ui';
import { cn, displayName, formatDate, formatDateTime, todayIST } from '@/lib/utils';

type ApprovalRow = ContentApproval & {
  requester: { full_name: string | null; email: string | null } | null;
  decider: { full_name: string | null; email: string | null } | null;
  contact: { name: string } | null;
};

export default async function ContentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();

  const { data: row } = await ctx.supabase
    .from('content_items')
    .select(
      '*, client:clients(id, name), project:projects(id, name), ' +
        'assignee:profiles!content_items_assignee_id_fkey(full_name, email), ' +
        'creator:profiles!content_items_created_by_fkey(full_name, email)',
    )
    .eq('id', id)
    .eq('agency_id', ctx.agencyId)
    .maybeSingle();
  if (!row) notFound();

  const item = row as unknown as ContentItem & {
    client: { id: string; name: string } | null;
    project: { id: string; name: string } | null;
    assignee: { full_name: string | null; email: string | null } | null;
    creator: { full_name: string | null; email: string | null } | null;
  };

  const [team, { data: approvalRows }, { data: commentRows }, { data: contacts }, { data: clients }, { data: projects }] =
    await Promise.all([
      getTeam(),
      ctx.supabase
        .from('content_approvals')
        .select(
          'id, content_item_id, round, decision, requested_by, requested_at, decided_at, comment, on_behalf, ' +
            'decided_by_contact_id, decided_by_profile_id, ' +
            'requester:profiles!content_approvals_requested_by_fkey(full_name, email), ' +
            'decider:profiles!content_approvals_decided_by_profile_id_fkey(full_name, email), ' +
            'contact:client_contacts(name)',
        )
        .eq('content_item_id', id)
        .order('round', { ascending: false }),
      ctx.supabase
        .from('content_comments')
        .select('id, body, created_at, author_id, visible_to_client, author:profiles(full_name, email)')
        .eq('content_item_id', id)
        .order('created_at'),
      ctx.isStaff && item.client
        ? ctx.supabase.from('client_contacts').select('id, name, is_primary').eq('client_id', item.client.id).order('name')
        : Promise.resolve({ data: [] as { id: string; name: string; is_primary: boolean }[] }),
      ctx.isStaff
        ? ctx.supabase.from('clients').select('id, name').eq('agency_id', ctx.agencyId).order('name')
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ctx.isStaff
        ? ctx.supabase
            .from('projects')
            .select('id, name, client_id')
            .eq('agency_id', ctx.agencyId)
            .in('status', ['planning', 'active', 'on_hold'])
            .order('name')
        : Promise.resolve({ data: [] as { id: string; name: string; client_id: string | null }[] }),
    ]);

  const approvals = (approvalRows ?? []) as unknown as ApprovalRow[];
  const comments = (commentRows ?? []) as unknown as {
    id: string;
    body: string;
    created_at: string;
    author_id: string | null;
    visible_to_client: boolean;
    author: { full_name: string | null; email: string | null } | null;
  }[];
  const pending = approvals.find((a) => a.decision === 'pending');
  const status = CONTENT_STATUSES.find((s) => s.value === item.status);
  const format = CONTENT_FORMATS.find((f) => f.value === item.format);
  const overRevisions = item.max_revisions !== null && item.revision_count > item.max_revisions;

  return (
    <>
      <PageHeader
        back={{ href: '/content', label: 'Content' }}
        title={item.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge className={status?.tone}>{status?.label}</Badge>
            <span>{format?.label}</span>
            {item.client && (
              <Link href={`/clients/${item.client.id}`} className="hover:text-brand-600">
                {item.client.name}
              </Link>
            )}
            <span>
              ·{' '}
              {item.scheduled_date
                ? `${formatDate(item.scheduled_date, true)}${item.scheduled_time ? ` at ${item.scheduled_time.slice(0, 5)}` : ''}`
                : 'Not scheduled'}
            </span>
            {item.assignee && <span>· {displayName(item.assignee)}</span>}
          </span>
        }
        actions={
          ctx.isStaff && (
            <div className="flex flex-wrap items-center gap-2">
              {!pending && item.status !== 'published' && (
                <form action={requestApproval.bind(null, item.id)}>
                  <SubmitButton pendingText="Sending…">Send to client</SubmitButton>
                </form>
              )}
              {(item.status === 'approved' || item.status === 'scheduled') && (
                <Disclosure summary="Mark published">
                  <form action={markPublished.bind(null, item.id)} className="space-y-3">
                    <Field label="Live post URL" hint="Optional, but handy for reporting">
                      <Input name="published_url" type="url" placeholder="https://instagram.com/p/…" />
                    </Field>
                    <SubmitButton pendingText="Saving…">Mark published</SubmitButton>
                  </form>
                </Disclosure>
              )}
            </div>
          )
        }
      />

      {overRevisions && (
        <p className="mb-5 rounded-lg border border-coral-400/40 bg-coral-500/10 px-3 py-2 text-sm text-ink">
          <span className="font-semibold">Past the agreed scope.</span> This post has had {item.revision_count} rounds of changes
          against {item.max_revisions} included. Anything further is billable — worth flagging to the client.
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Caption" subtitle={item.platforms?.length ? item.platforms.join(' · ') : 'No platforms set'} />
            <div className="space-y-4 px-5 py-4">
              <p className="whitespace-pre-wrap text-sm text-zinc-700">{item.caption || 'No caption written yet.'}</p>
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
              {item.notes && (
                <div className="rounded-lg bg-zinc-50 px-3 py-2">
                  <p className="text-xs font-medium text-zinc-500">Internal notes</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-600">{item.notes}</p>
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

          {ctx.isStaff ? (
            <Disclosure summary="Edit content">
              <ContentForm
                action={updateContent.bind(null, item.id)}
                clients={clients ?? []}
                projects={projects ?? []}
                team={team}
                item={item}
                submitLabel="Save changes"
              />
              <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-4">
                <form action={duplicateContent.bind(null, item.id)} className="flex items-end gap-2">
                  <Field label="Duplicate to date">
                    <Input name="scheduled_date" type="date" defaultValue={todayIST()} />
                  </Field>
                  <SubmitButton variant="secondary" size="sm" pendingText="Copying…">Duplicate</SubmitButton>
                </form>
                {ctx.isManager && (
                  <form action={deleteContent.bind(null, item.id)}>
                    <SubmitButton variant="danger" size="sm" confirm="Delete this content and its approval history?" pendingText="Deleting…">
                      Delete
                    </SubmitButton>
                  </form>
                )}
              </div>
            </Disclosure>
          ) : (
            <Card>
              <CardHeader title="Your update" subtitle="Move this along as you work on it" />
              <form action={updateContent.bind(null, item.id)} className="flex items-end gap-2 px-5 py-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-600">Move to</span>
                  <Select name="status" defaultValue={item.status} className="w-auto">
                    {CONTENT_STATUSES.filter((s) => s.board).map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </Select>
                </label>
                <SubmitButton>Update status</SubmitButton>
              </form>
            </Card>
          )}

          <Card>
            <CardHeader title="Comments" subtitle={`${comments.length} so far`} />
            <ul className="divide-y divide-zinc-100">
              {comments.map((c) => (
                <li key={c.id} className="flex gap-3 px-5 py-3.5">
                  <Avatar person={c.author} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs">
                      <span className="font-semibold text-ink">{displayName(c.author)}</span>
                      <span className="ml-2 text-zinc-400">{formatDateTime(c.created_at)}</span>
                      {c.visible_to_client && <Badge className="ml-2 bg-brand-50 text-brand-700">Client can see</Badge>}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700">{c.body}</p>
                  </div>
                </li>
              ))}
              {comments.length === 0 && <li className="px-5 py-4 text-sm text-zinc-500">No comments yet.</li>}
            </ul>
            <form action={addContentComment.bind(null, item.id)} className="space-y-2 border-t border-zinc-100 px-5 py-4">
              <Textarea name="body" rows={2} required placeholder="Feedback, a change, or a note for the team…" />
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-zinc-600">
                  <input type="checkbox" name="visible_to_client" /> Client can see this
                </label>
                <SubmitButton size="sm">Comment</SubmitButton>
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Client approval"
              subtitle={
                pending
                  ? `Round ${pending.round} — waiting since ${formatDate(pending.requested_at, true)}`
                  : approvals.length
                    ? `${approvals.length} round${approvals.length === 1 ? '' : 's'} so far`
                    : 'Not sent yet'
              }
            />

            {pending && ctx.isStaff && (
              <form action={recordDecision.bind(null, pending.id)} className="space-y-3 border-b border-zinc-100 px-5 py-4">
                <input type="hidden" name="item_id" value={item.id} />
                <p className="text-xs text-zinc-500">
                  Record what the client said. Until the client portal ships, this is logged as entered on their behalf.
                </p>
                <Field label="Decision">
                  <Select name="decision" required defaultValue="approved">
                    <option value="approved">Approved</option>
                    <option value="changes_requested">Changes requested</option>
                  </Select>
                </Field>
                {!!contacts?.length && (
                  <Field label="Who said so" hint="Which contact at the client">
                    <Select name="contact_id" defaultValue={contacts.find((c) => c.is_primary)?.id ?? ''}>
                      <option value="">Not recorded</option>
                      {contacts.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label="Their words" hint="Required when asking for changes">
                  <Textarea name="comment" rows={3} placeholder="e.g. Make the logo bigger on frame 2" />
                </Field>
                <SubmitButton pendingText="Recording…">Record decision</SubmitButton>
              </form>
            )}

            {approvals.length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-500">
                This has not been sent to the client yet. Use <span className="font-medium text-ink">Send to client</span> above, or
                drag the card into <span className="font-medium text-ink">With client</span> on the board.
              </p>
            ) : (
              <ol className="divide-y divide-zinc-100">
                {approvals.map((a) => (
                  <li key={a.id} className="px-5 py-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-ink">Round {a.round}</p>
                      <Badge
                        className={cn(
                          a.decision === 'approved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : a.decision === 'changes_requested'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-brand-100 text-brand-800',
                        )}
                      >
                        {a.decision === 'pending' ? 'Waiting' : a.decision === 'approved' ? 'Approved' : 'Changes requested'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      Sent by {displayName(a.requester)} on {formatDateTime(a.requested_at)}
                    </p>
                    {a.decided_at && (
                      <p className="text-[11px] text-zinc-500">
                        {a.contact?.name ? `${a.contact.name} ` : ''}
                        {a.decision === 'approved' ? 'approved' : 'asked for changes'} on {formatDateTime(a.decided_at)}
                        {a.on_behalf && <span className="text-zinc-400"> · recorded by {displayName(a.decider)}</span>}
                      </p>
                    )}
                    {a.comment && <p className="mt-1.5 whitespace-pre-wrap text-sm text-zinc-700">“{a.comment}”</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card>
            <CardHeader title="Details" />
            <dl className="grid gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-2">
              {[
                ['Revisions', `${item.revision_count}${item.max_revisions != null ? ` of ${item.max_revisions}` : ''}`],
                ['Format', format?.label ?? item.format],
                ['Owner', displayName(item.assignee)],
                ['Added by', displayName(item.creator)],
                ['Project', item.project?.name ?? '—'],
                ['Published', item.published_at ? formatDateTime(item.published_at) : '—'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium text-zinc-500">{label}</dt>
                  <dd className={cn('mt-0.5 text-sm', label === 'Revisions' && overRevisions ? 'font-semibold text-coral-500' : 'text-ink')}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
