import { notFound } from 'next/navigation';
import { getContext } from '@/lib/auth';
import { getPlan } from '@/lib/plan';
import { startTrial } from '@/lib/actions/plan';
import { formatDate, formatINR } from '@/lib/utils';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Card, CardHeader, PageHeader, Stat } from '@/components/ui';

export const metadata = { title: 'Plan' };

interface PlanRow {
  code: string;
  name: string;
  price_monthly: number | null;
  max_members: number | null;
  max_clients: number | null;
  features: string[];
}

const FEATURE_LABELS: Record<string, string> = {
  content: 'Content calendar and client approvals',
  invoicing: 'GST invoicing',
  portal: 'Client portal',
  assets: 'Brand and asset library',
  profitability: 'Profitability and expenses',
  automations: 'Automations',
  reports: 'Client reports',
  media: 'Media planning',
  influencers: 'Influencer marketing',
  seo: 'SEO tracking',
  assistant: 'AI assistant',
  hr: 'Leave and HR',
};

function Usage({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max === null ? 0 : Math.min(100, Math.round((used / max) * 100));
  return (
    <div>
      <p className="flex justify-between text-sm">
        <span className="text-zinc-600">{label}</span>
        <span className="font-medium text-ink">
          {used} {max === null ? '· unlimited' : `of ${max}`}
        </span>
      </p>
      {max !== null && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-200">
          <div
            className={pct >= 100 ? 'h-full bg-red-500' : pct >= 80 ? 'h-full bg-amber-500' : 'h-full bg-brand-500'}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default async function PlanPage() {
  const ctx = await getContext();
  // Seats and money are the owner's and admins' business.
  if (!ctx.isAdmin) notFound();

  const plan = await getPlan();
  const { data: catalogue } = await ctx.supabase
    .from('plans')
    .select('code, name, price_monthly, max_members, max_clients, features')
    .eq('active', true)
    .order('sort_order');
  const plans = (catalogue ?? []) as PlanRow[];
  const usage = plan.usage;
  const isOwner = ctx.role === 'owner';

  return (
    <>
      <PageHeader
        title="Plan"
        subtitle={usage?.plan_name ?? 'Self-hosted'}
        back={{ href: '/settings', label: 'Settings' }}
      />

      {plan.selfHosted ? (
        <Card className="mb-6 p-5">
          <h2 className="text-sm font-semibold text-ink">This install is not metered</h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600">
            No subscription is attached to {ctx.agency.name}, so every module is switched on and there are no seat or
            client limits. That is deliberate: this platform is your own install first and a product second, and a
            migration that quietly capped a running agency at three seats would be a bug, not a limit.
          </p>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600">
            Limits start the moment a subscription row exists — which is what signing another agency up would create.
          </p>
          {isOwner && plans.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {plans.map((p) => (
                <form key={p.code} action={startTrial.bind(null, p.code)}>
                  <SubmitButton
                    variant="secondary"
                    size="sm"
                    confirm={`Start a 14-day ${p.name} trial? This begins metering ${ctx.agency.name} against that plan's limits.`}
                  >
                    Try {p.name}
                  </SubmitButton>
                </form>
              ))}
            </div>
          )}
        </Card>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Plan" value={usage?.plan_name ?? '—'} />
            <Stat
              label="Status"
              value={<Badge className={usage?.status === 'past_due' ? 'bg-red-100 text-red-700' : undefined}>{usage?.status}</Badge>}
            />
            <Stat label="Trial ends" value={usage?.trial_ends_on ? formatDate(usage.trial_ends_on, true) : '—'} />
            <Stat label="Renews" value={usage?.current_period_end ? formatDate(usage.current_period_end, true) : '—'} />
          </div>

          <Card className="mb-6 space-y-4 p-5">
            <CardHeader title="Usage" subtitle="Deactivated members and churned clients do not count" />
            <Usage label="Seats in use" used={usage?.members ?? 0} max={usage?.max_members ?? null} />
            <Usage label="Clients" used={usage?.clients ?? 0} max={usage?.max_clients ?? null} />
          </Card>
        </>
      )}

      <Card className="mb-6">
        <CardHeader title="What this plan includes" />
        <ul className="grid gap-1.5 px-4 pb-4 text-sm sm:grid-cols-2">
          {Object.entries(FEATURE_LABELS).map(([key, label]) => (
            <li key={key} className={plan.has(key as never) ? 'text-ink' : 'text-zinc-400'}>
              {plan.has(key as never) ? '✓' : '·'} {label}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Plans" subtitle="Prices exclude GST" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200/70 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Plan</th>
                <th className="px-4 py-2.5 text-right font-medium">Per month</th>
                <th className="px-4 py-2.5 text-right font-medium">Seats</th>
                <th className="px-4 py-2.5 text-right font-medium">Clients</th>
                <th className="px-4 py-2.5 text-right font-medium">Modules</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200/70">
              {plans.map((p) => (
                <tr key={p.code} className={p.code === usage?.plan_code ? 'bg-brand-50/60' : undefined}>
                  <td className="px-4 py-2.5 font-medium text-ink">
                    {p.name}
                    {p.code === usage?.plan_code && <Badge className="ml-2 bg-brand-100 text-brand-800">Current</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-zinc-600">
                    {p.price_monthly === null ? 'Talk to us' : formatINR(p.price_monthly)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-zinc-600">{p.max_members ?? 'Unlimited'}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-600">{p.max_clients ?? 'Unlimited'}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-600">{p.features.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-4 max-w-2xl text-xs text-zinc-500">
        There is no payment integration yet, and that is a missing account rather than missing code: Razorpay needs a
        registered business, KYC and a live key. Until one exists, a plan is set by hand in the Supabase SQL editor —
        no agency can change its own, which is enforced by there being no write policy on the subscription table at
        all. The shape the webhook would take is written down in{' '}
        <code className="rounded bg-zinc-100 px-1">0013_plans.sql</code>.
      </p>
    </>
  );
}
