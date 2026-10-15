import { notFound } from 'next/navigation';
import { getContext } from '@/lib/auth';
import {
  bookCollabFee,
  createCollab,
  deleteCollab,
  deleteInfluencer,
  updateCollab,
  updateInfluencer,
} from '@/lib/actions/influencers';
import { COLLAB_STATUSES, INFLUENCER_PLATFORMS, INFLUENCER_STATUSES } from '@/lib/constants';
import { formatDate, formatINR } from '@/lib/utils';
import { SubmitButton } from '@/components/submit-button';
import {
  Badge,
  Card,
  CardHeader,
  Disclosure,
  Field,
  Input,
  PageHeader,
  Select,
  Stat,
  Textarea,
} from '@/components/ui';
import type { Influencer, InfluencerCollab } from '@/lib/types';

export const metadata = { title: 'Influencer' };

export default async function InfluencerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx.isStaff) notFound();

  const [{ data: inf }, { data: collabRows }, { data: clients }, { data: projects }] = await Promise.all([
    ctx.supabase.from('influencers').select('*').eq('id', id).maybeSingle(),
    ctx.supabase
      .from('influencer_collabs')
      .select('*, client:clients(id, name)')
      .eq('influencer_id', id)
      .order('go_live_on', { nullsFirst: false }),
    ctx.supabase.from('clients').select('id, name').eq('agency_id', ctx.agencyId).order('name'),
    ctx.supabase.from('projects').select('id, name').eq('agency_id', ctx.agencyId).order('name'),
  ]);
  if (!inf) notFound();

  const influencer = inf as Influencer;
  const collabs = (collabRows ?? []) as unknown as (InfluencerCollab & { client: { id: string; name: string } | null })[];
  const status = INFLUENCER_STATUSES.find((s) => s.value === influencer.status);
  const spent = collabs.filter((c) => c.status !== 'cancelled').reduce((s, c) => s + Number(c.fee), 0);

  return (
    <>
      <PageHeader
        title={influencer.name}
        subtitle={[influencer.handle, influencer.platform, influencer.city].filter(Boolean).join(' · ')}
        back={{ href: '/influencers', label: 'Influencers' }}
        actions={
          ctx.isManager ? (
            <form action={deleteInfluencer.bind(null, influencer.id)}>
              <SubmitButton variant="ghost" confirm={`Remove ${influencer.name} from the roster?`}>
                Delete
              </SubmitButton>
            </form>
          ) : undefined
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Status" value={<Badge className={status?.tone}>{status?.label}</Badge>} />
        <Stat label="Rate card" value={influencer.rate_card === null ? '—' : formatINR(influencer.rate_card)} />
        <Stat label="Collaborations" value={collabs.length} />
        <Stat label="Fees committed" value={formatINR(spent)} hint="Excludes cancelled" />
      </div>

      {(influencer.email || influencer.phone || influencer.profile_url || influencer.niches?.length) && (
        <Card className="mb-5 p-4 text-sm text-zinc-600">
          <dl className="grid gap-3 sm:grid-cols-2">
            {influencer.email && (
              <div>
                <dt className="text-xs text-zinc-400">Email</dt>
                <dd>{influencer.email}</dd>
              </div>
            )}
            {influencer.phone && (
              <div>
                <dt className="text-xs text-zinc-400">Phone</dt>
                <dd>{influencer.phone}</dd>
              </div>
            )}
            {influencer.profile_url && (
              <div>
                <dt className="text-xs text-zinc-400">Profile</dt>
                <dd>
                  <a className="text-brand-700 underline" href={influencer.profile_url} target="_blank" rel="noreferrer">
                    {influencer.profile_url}
                  </a>
                </dd>
              </div>
            )}
            {influencer.niches?.length ? (
              <div>
                <dt className="text-xs text-zinc-400">Niches</dt>
                <dd className="flex flex-wrap gap-1 pt-0.5">
                  {influencer.niches.map((n) => (
                    <Badge key={n}>{n}</Badge>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>
          {influencer.notes && <p className="mt-3 whitespace-pre-wrap border-t border-zinc-200/70 pt-3">{influencer.notes}</p>}
        </Card>
      )}

      <Card className="mb-5">
        <CardHeader title="Collaborations" subtitle="One campaign with one client" />
        {collabs.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-zinc-500">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200/70">
            {collabs.map((c) => {
              const cs = COLLAB_STATUSES.find((s) => s.value === c.status);
              return (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium text-ink">
                        {c.title}
                        <Badge className={cs?.tone}>{cs?.label}</Badge>
                        {c.expense_id && <Badge className="bg-emerald-50 text-emerald-700">Fee booked</Badge>}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {c.client?.name ?? 'a client'} · {formatINR(c.fee)}
                        {c.go_live_on && ` · live ${formatDate(c.go_live_on)}`}
                      </p>
                      {c.deliverables && <p className="mt-1 text-xs text-zinc-600">{c.deliverables}</p>}
                      <div className="mt-1 flex gap-3 text-xs">
                        {c.brief_url && (
                          <a className="text-brand-700 underline" href={c.brief_url} target="_blank" rel="noreferrer">
                            Brief
                          </a>
                        )}
                        {c.live_url && (
                          <a className="text-brand-700 underline" href={c.live_url} target="_blank" rel="noreferrer">
                            Live post
                          </a>
                        )}
                      </div>
                    </div>
                    {ctx.isManager && (
                      <div className="flex gap-2">
                        {!c.expense_id && Number(c.fee) > 0 && (
                          <form action={bookCollabFee.bind(null, c.id, influencer.id)}>
                            <SubmitButton
                              variant="secondary"
                              size="sm"
                              confirm={`Book ${formatINR(c.fee)} as a cost against ${c.client?.name ?? 'the client'}?`}
                            >
                              Book fee
                            </SubmitButton>
                          </form>
                        )}
                        <form action={deleteCollab.bind(null, c.id, influencer.id)}>
                          <SubmitButton variant="ghost" size="sm" confirm="Delete this collaboration?">
                            Delete
                          </SubmitButton>
                        </form>
                      </div>
                    )}
                  </div>

                  {ctx.isManager && (
                    <Disclosure summary="Edit">
                      <form action={updateCollab.bind(null, c.id, influencer.id)} className="grid gap-3 sm:grid-cols-2">
                        <Field label="Title">
                          <Input name="title" defaultValue={c.title} />
                        </Field>
                        <Field label="Status">
                          <Select name="status" defaultValue={c.status}>
                            {COLLAB_STATUSES.map((s) => (
                              <option key={s.value} value={s.value}>
                                {s.label}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Fee">
                          <Input name="fee" type="number" step="0.01" min={0} defaultValue={c.fee} />
                        </Field>
                        <Field label="Goes live on">
                          <Input name="go_live_on" type="date" defaultValue={c.go_live_on ?? ''} />
                        </Field>
                        <Field label="Brief URL">
                          <Input name="brief_url" type="url" defaultValue={c.brief_url ?? ''} />
                        </Field>
                        <Field label="Live post URL">
                          <Input name="live_url" type="url" defaultValue={c.live_url ?? ''} />
                        </Field>
                        <div className="sm:col-span-2">
                          <Field label="Deliverables">
                            <Textarea name="deliverables" rows={2} defaultValue={c.deliverables ?? ''} />
                          </Field>
                        </div>
                        <div className="sm:col-span-2">
                          <SubmitButton size="sm" pendingText="Saving…">
                            Save
                          </SubmitButton>
                          {c.expense_id && (
                            <p className="mt-2 text-xs text-zinc-500">
                              The fee is already booked as an expense. Changing it here does not change the expense —
                              edit that on the profitability page, so the cost and the booking stay in step.
                            </p>
                          )}
                        </div>
                      </form>
                    </Disclosure>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {ctx.isManager && (
        <div className="space-y-4">
          <Disclosure summary="New collaboration">
            <form action={createCollab.bind(null, influencer.id)} className="grid gap-4 sm:grid-cols-2">
              <Field label="Client">
                <Select name="client_id" required defaultValue="">
                  <option value="">Choose a client…</option>
                  {(clients ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Title">
                <Input name="title" required placeholder="Diwali reel" />
              </Field>
              <Field label="Project" hint="Optional.">
                <Select name="project_id" defaultValue="">
                  <option value="">None</option>
                  {(projects ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Fee" hint="What we pay them. Booked as a cost against the client.">
                <Input name="fee" type="number" step="0.01" min={0} defaultValue={influencer.rate_card ?? 0} />
              </Field>
              <Field label="Goes live on">
                <Input name="go_live_on" type="date" />
              </Field>
              <Field label="Brief URL">
                <Input name="brief_url" type="url" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Deliverables">
                  <Textarea name="deliverables" rows={2} placeholder="1 reel + 2 stories, 30-day usage rights" />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <SubmitButton pendingText="Saving…">Create collaboration</SubmitButton>
              </div>
            </form>
          </Disclosure>

          <Disclosure summary="Edit influencer">
            <form action={updateInfluencer.bind(null, influencer.id)} className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input name="name" defaultValue={influencer.name} required />
              </Field>
              <Field label="Handle">
                <Input name="handle" defaultValue={influencer.handle ?? ''} />
              </Field>
              <Field label="Platform">
                <Select name="platform" defaultValue={influencer.platform}>
                  {INFLUENCER_PLATFORMS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Profile URL">
                <Input name="profile_url" type="url" defaultValue={influencer.profile_url ?? ''} />
              </Field>
              <Field label="Followers">
                <Input name="followers" type="number" min={0} defaultValue={influencer.followers ?? ''} />
              </Field>
              <Field label="Engagement rate %">
                <Input
                  name="engagement_rate"
                  type="number"
                  step="0.01"
                  min={0}
                  defaultValue={influencer.engagement_rate ?? ''}
                />
              </Field>
              <Field label="Niches" hint="Comma separated.">
                <Input name="niches" defaultValue={(influencer.niches ?? []).join(', ')} />
              </Field>
              <Field label="City">
                <Input name="city" defaultValue={influencer.city ?? ''} />
              </Field>
              <Field label="Email">
                <Input name="email" type="email" defaultValue={influencer.email ?? ''} />
              </Field>
              <Field label="Phone">
                <Input name="phone" defaultValue={influencer.phone ?? ''} />
              </Field>
              <Field label="Rate card">
                <Input name="rate_card" type="number" step="0.01" min={0} defaultValue={influencer.rate_card ?? ''} />
              </Field>
              <Field label="Status">
                <Select name="status" defaultValue={influencer.status}>
                  {INFLUENCER_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes">
                  <Textarea name="notes" rows={3} defaultValue={influencer.notes ?? ''} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
              </div>
            </form>
          </Disclosure>
        </div>
      )}
    </>
  );
}
