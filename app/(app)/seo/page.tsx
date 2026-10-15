import { notFound } from 'next/navigation';
import { getContext } from '@/lib/auth';
import { getPlan } from '@/lib/plan';
import { addKeyword, archiveKeyword, importRankings, recordRanking } from '@/lib/actions/seo';
import { SEO_PRIORITIES } from '@/lib/constants';
import { addDays, formatDate, todayIST } from '@/lib/utils';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Card, CardHeader, Disclosure, EmptyState, Field, Input, PageHeader, Select, Stat, Textarea } from '@/components/ui';
import type { SeoProgress } from '@/lib/types';

export const metadata = { title: 'SEO' };

/** Positive delta means the keyword climbed. Rendered so that is obvious. */
function Delta({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-zinc-400">—</span>;
  if (delta === 0) return <span className="text-zinc-500">no change</span>;
  return (
    <span className={delta > 0 ? 'text-emerald-700' : 'text-red-700'}>
      {delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`}
    </span>
  );
}

export default async function SeoPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.isStaff) notFound();
  // Hiding the nav link is not enforcement; the page has to refuse too.
  if (!(await getPlan()).has('seo')) notFound();

  const { data: clients } = await ctx.supabase
    .from('clients')
    .select('id, name')
    .eq('agency_id', ctx.agencyId)
    .order('name');

  const clientId = sp.client ?? clients?.[0]?.id ?? null;
  const today = todayIST();
  const from = sp.from ?? addDays(today, -90);
  const to = sp.to ?? today;

  const [{ data: progressRows }, { data: keywordRows }] = await Promise.all([
    clientId
      ? ctx.supabase.rpc('seo_progress', {
          agency: ctx.agencyId,
          client: clientId,
          from_date: from,
          to_date: to,
        })
      : Promise.resolve({ data: [] }),
    clientId
      ? ctx.supabase
          .from('seo_keywords')
          .select('id, keyword, active')
          .eq('client_id', clientId)
          .eq('active', true)
          .order('keyword')
      : Promise.resolve({ data: [] }),
  ]);

  const rows = (progressRows ?? []) as SeoProgress[];
  const keywords = (keywordRows ?? []) as { id: string; keyword: string }[];
  const ranked = rows.filter((r) => r.last_position !== null);
  const topTen = ranked.filter((r) => (r.last_position ?? 101) <= 10);
  const climbed = rows.filter((r) => (r.delta ?? 0) > 0);

  return (
    <>
      <PageHeader title="SEO" subtitle="Keywords and where they rank" />

      {(clients ?? []).length === 0 ? (
        <EmptyState title="No clients yet" body="Add a client first — keywords are tracked per client." />
      ) : (
        <>
          <form className="mb-5 flex flex-wrap items-end gap-2">
            <Field label="Client">
              <Select name="client" defaultValue={clientId ?? ''} className="max-w-xs">
                {(clients ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From">
              <Input name="from" type="date" defaultValue={from} />
            </Field>
            <Field label="To">
              <Input name="to" type="date" defaultValue={to} />
            </Field>
            <SubmitButton variant="secondary">Show</SubmitButton>
          </form>

          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Keywords tracked" value={rows.length} />
            <Stat label="Ranking in the top 100" value={ranked.length} />
            <Stat label="In the top 10" value={topTen.length} />
            <Stat label="Improved in this window" value={climbed.length} />
          </div>

          {rows.length === 0 ? (
            <EmptyState title="No keywords for this client" body="Add the ones you are being paid to move." />
          ) : (
            <Card className="mb-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-200/70 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Keyword</th>
                    <th className="px-4 py-2.5 text-right font-medium">Volume</th>
                    <th className="px-4 py-2.5 text-right font-medium">KD</th>
                    <th className="px-4 py-2.5 text-right font-medium">Start</th>
                    <th className="px-4 py-2.5 text-right font-medium">Now</th>
                    <th className="px-4 py-2.5 text-right font-medium">Best</th>
                    <th className="px-4 py-2.5 text-right font-medium">Change</th>
                    <th className="px-4 py-2.5 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200/70">
                  {rows.map((r) => (
                    <tr key={r.keyword_id} className="hover:bg-zinc-50">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-ink">
                          {r.keyword}{' '}
                          <Badge className="bg-zinc-100 text-zinc-600">
                            {SEO_PRIORITIES.find((p) => p.value === r.priority)?.label}
                          </Badge>
                        </p>
                        {r.target_url && <p className="truncate text-xs text-zinc-400">{r.target_url}</p>}
                        <p className="text-xs text-zinc-400">
                          {r.checks === 0
                            ? 'never checked in this window'
                            : `${r.checks} check(s), last ${formatDate(r.last_checked)}`}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-right text-zinc-600">{r.search_volume ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-600">{r.difficulty ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-600">{r.first_position ?? '>100'}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-ink">{r.last_position ?? '>100'}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-600">{r.best_position ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Delta delta={r.delta} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Disclosure summary="Log">
                          {/* Two sibling forms, not nested: a form inside a form is invalid HTML
                              and the browser drops the inner one. */}
                          <form
                            action={recordRanking.bind(null, r.keyword_id, clientId!)}
                            className="grid gap-2 text-left sm:grid-cols-2"
                          >
                            <Field label="Checked on">
                              <Input name="checked_on" type="date" required defaultValue={today} />
                            </Field>
                            <Field label="Position" hint="Leave blank for “not in the top 100”.">
                              <Input name="position" type="number" min={1} max={100} />
                            </Field>
                            <Field label="Ranking URL">
                              <Input name="ranking_url" type="url" />
                            </Field>
                            <Field label="Source">
                              <Input name="source" placeholder="Search Console, Semrush…" />
                            </Field>
                            <div className="sm:col-span-2">
                              <SubmitButton size="sm" pendingText="Saving…">
                                Save check
                              </SubmitButton>
                            </div>
                          </form>
                          <form
                            action={archiveKeyword.bind(null, r.keyword_id, clientId!)}
                            className="mt-2 text-left"
                          >
                            <SubmitButton variant="ghost" size="sm" confirm={`Stop tracking “${r.keyword}”?`}>
                              Stop tracking
                            </SubmitButton>
                          </form>
                        </Disclosure>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <div className="space-y-4">
            <Disclosure summary="Add a keyword" open={rows.length === 0}>
              <form action={addKeyword} className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="client_id" value={clientId ?? ''} />
                <Field label="Keyword">
                  <Input name="keyword" required placeholder="social media agency in pune" />
                </Field>
                <Field label="Target URL" hint="The page you want to rank.">
                  <Input name="target_url" type="url" />
                </Field>
                <Field label="Monthly searches">
                  <Input name="search_volume" type="number" min={0} />
                </Field>
                <Field label="Difficulty" hint="0–100, however your tool defines it.">
                  <Input name="difficulty" type="number" min={0} max={100} />
                </Field>
                <Field label="Priority">
                  <Select name="priority" defaultValue="2">
                    {SEO_PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="sm:col-span-2">
                  <SubmitButton pendingText="Saving…">Track this keyword</SubmitButton>
                </div>
              </form>
            </Disclosure>

            <Disclosure summary="Paste a batch of positions">
              <form action={importRankings} className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="client_id" value={clientId ?? ''} />
                <Field label="Checked on">
                  <Input name="checked_on" type="date" required defaultValue={today} />
                </Field>
                <Field label="Source">
                  <Input name="source" placeholder="Semrush export" />
                </Field>
                <div className="sm:col-span-2">
                  <Field
                    label="One keyword per line"
                    hint="keyword,position — comma or tab separated. A position outside 1–100 counts as not ranking."
                  >
                    <Textarea
                      name="block"
                      rows={6}
                      required
                      placeholder={'social media agency in pune,14\nperformance marketing pune,38'}
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <SubmitButton pendingText="Importing…">Import</SubmitButton>
                  <p className="mt-2 text-xs text-zinc-500">
                    Keywords that are not already tracked for this client are skipped and named back to you, rather
                    than created — a typo making a second keyword row is worse than being told about it. Re-importing
                    the same day corrects it instead of duplicating.
                  </p>
                </div>
              </form>
            </Disclosure>
          </div>

          <p className="mt-6 text-xs text-zinc-500">
            Positions are entered by hand or pasted from whatever rank tracker you use. There is no rank-tracking
            integration: every usable API (Semrush, Ahrefs, DataForSEO) is paid and account-gated. The schema is the
            part that would not change if one were added — one row per keyword per date.
          </p>
          {keywords.length > 0 && rows.length === 0 && (
            <p className="mt-2 text-xs text-amber-700">
              {keywords.length} keyword(s) are tracked but none were checked in this window. Widen the dates.
            </p>
          )}
        </>
      )}
    </>
  );
}
