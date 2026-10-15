import 'server-only';
import { cache } from 'react';
import { getContext } from '@/lib/auth';

/**
 * Plan features, as stored in `plans.features`. Only the modules an agency can
 * genuinely do without are listed — the core (tasks, clients, projects, time,
 * chat, team) is not a feature flag, because an agency that cannot see its own
 * clients has not been downgraded, it has been locked out.
 */
export type PlanFeature =
  | 'content'
  | 'invoicing'
  | 'portal'
  | 'assets'
  | 'profitability'
  | 'automations'
  | 'reports'
  | 'media'
  | 'influencers'
  | 'seo'
  | 'assistant'
  | 'hr';

export interface PlanUsage {
  plan_code: string;
  plan_name: string;
  status: string;
  members: number;
  max_members: number | null;
  clients: number;
  max_clients: number | null;
  trial_ends_on: string | null;
  current_period_end: string | null;
}

/**
 * The agency's plan and current usage. Cached per request, so the layout, the
 * nav and a page can each ask without three round trips.
 *
 * An agency with no subscription row comes back as `self_hosted` with null
 * limits and every feature — see 0013_plans.sql for why that, and not the entry
 * plan, is the fallback.
 */
export const getPlan = cache(async () => {
  const ctx = await getContext();
  const [{ data: usage }, { data: plan }] = await Promise.all([
    ctx.supabase.rpc('plan_usage', { agency: ctx.agencyId }),
    ctx.supabase.rpc('agency_plan', { agency: ctx.agencyId }),
  ]);

  const row = (usage as PlanUsage[] | null)?.[0] ?? null;
  const features = ((plan as { features?: string[] } | null)?.features ?? []) as PlanFeature[];

  return {
    usage: row,
    features,
    has: (f: PlanFeature) => features.includes(f),
    /** True while nobody is paying — the agency's own install. */
    selfHosted: (row?.plan_code ?? 'self_hosted') === 'self_hosted',
  };
});

export type Plan = Awaited<ReturnType<typeof getPlan>>;
