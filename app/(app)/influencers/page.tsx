import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/auth';
import { getPlan } from '@/lib/plan';
import { createInfluencer } from '@/lib/actions/influencers';
import { INFLUENCER_NICHES, INFLUENCER_PLATFORMS, INFLUENCER_STATUSES } from '@/lib/constants';
import { formatINR } from '@/lib/utils';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Card, Disclosure, EmptyState, Field, Input, PageHeader, Select, Stat, Textarea } from '@/components/ui';
import type { Influencer, InfluencerStatus } from '@/lib/types';

export const metadata = { title: 'Influencers' };

function compactFollowers(n: number | null) {
  if (n === null) return '—';
  if (n >= 10000000) return `${(n / 10000000).toFixed(1)}cr`;
  if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default async function InfluencersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; new?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.isStaff) notFound();
  // Hiding the nav link is not enforcement; the page has to refuse too.
  if (!(await getPlan()).has('influencers')) notFound();

  let q = ctx.supabase.from('influencers').select('*').eq('agency_id', ctx.agencyId);
  if (sp.status) q = q.eq('status', sp.status as InfluencerStatus);
  if (sp.q) q = q.or(`name.ilike.%${sp.q}%,handle.ilike.%${sp.q}%,city.ilike.%${sp.q}%`);

  const [{ data, error }, { count: collabCount }] = await Promise.all([
    q.order('name').limit(300),
    ctx.supabase
      .from('influencer_collabs')
      .select('id', { count: 'exact', head: true })
      .eq('agency_id', ctx.agencyId)
      .in('status', ['planned', 'briefed', 'content_due', 'live']),
  ]);

  const list = (data ?? []) as Influencer[];

  return (
    <>
      <PageHeader title="Influencers" subtitle="Roster, rates and collaborations" />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="On the roster" value={list.length} />
        <Stat label="Working with us" value={list.filter((i) => i.status === 'active').length} />
        <Stat label="Live collaborations" value={collabCount ?? 0} />
        <Stat
          label="Median rate"
          value={(() => {
            const rates = list.map((i) => i.rate_card).filter((r): r is number => r !== null).sort((a, b) => a - b);
            return rates.length ? formatINR(rates[Math.floor(rates.length / 2)]) : '—';
          })()}
        />
      </div>

      <form className="mb-5 flex flex-wrap gap-2">
        <Input name="q" defaultValue={sp.q ?? ''} placeholder="Name, handle or city" className="max-w-xs" />
        <Select name="status" defaultValue={sp.status ?? ''} className="max-w-[12rem]">
          <option value="">Any status</option>
          {INFLUENCER_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <SubmitButton variant="secondary">Filter</SubmitButton>
      </form>

      {ctx.isManager && (
        <div className="mb-5">
          <Disclosure summary="Add an influencer" open={sp.new === '1'}>
            <form action={createInfluencer} className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input name="name" required />
              </Field>
              <Field label="Handle">
                <Input name="handle" placeholder="@someone" />
              </Field>
              <Field label="Platform">
                <Select name="platform" defaultValue="Instagram">
                  {INFLUENCER_PLATFORMS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Profile URL">
                <Input name="profile_url" type="url" />
              </Field>
              <Field label="Followers">
                <Input name="followers" type="number" min={0} />
              </Field>
              <Field label="Engagement rate %" hint="As quoted in their media kit, e.g. 2.4">
                <Input name="engagement_rate" type="number" step="0.01" min={0} />
              </Field>
              <Field label="Niches" hint={`Comma separated. E.g. ${INFLUENCER_NICHES.slice(0, 3).join(', ')}`}>
                <Input name="niches" />
              </Field>
              <Field label="City">
                <Input name="city" />
              </Field>
              <Field label="Email">
                <Input name="email" type="email" />
              </Field>
              <Field label="Phone">
                <Input name="phone" />
              </Field>
              <Field label="Rate card" hint="Quoted price for one deliverable, before negotiating.">
                <Input name="rate_card" type="number" step="0.01" min={0} />
              </Field>
              <Field label="Status">
                <Select name="status" defaultValue="prospect">
                  {INFLUENCER_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes">
                  <Textarea name="notes" rows={2} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <SubmitButton pendingText="Saving…">Add to the roster</SubmitButton>
              </div>
            </form>
          </Disclosure>
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load the roster: {error.message}
        </p>
      )}

      {list.length === 0 ? (
        <EmptyState
          title="Nobody on the roster yet"
          body={ctx.isManager ? 'Add the people you already work with first.' : 'A manager adds people to the roster.'}
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200/70 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Platform</th>
                <th className="px-4 py-2.5 text-right font-medium">Followers</th>
                <th className="px-4 py-2.5 text-right font-medium">Eng.</th>
                <th className="px-4 py-2.5 text-right font-medium">Rate</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200/70">
              {list.map((i) => {
                const status = INFLUENCER_STATUSES.find((s) => s.value === i.status);
                return (
                  <tr key={i.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-2.5">
                      <Link href={`/influencers/${i.id}`} className="font-medium text-ink hover:text-brand-700">
                        {i.name}
                      </Link>
                      {i.handle && <span className="ml-1.5 text-xs text-zinc-500">{i.handle}</span>}
                      {i.city && <p className="text-xs text-zinc-400">{i.city}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-600">{i.platform}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-600">{compactFollowers(i.followers)}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-600">
                      {i.engagement_rate === null ? '—' : `${i.engagement_rate}%`}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-600">
                      {i.rate_card === null ? '—' : formatINR(i.rate_card)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge className={status?.tone}>{status?.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
