'use server';

import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/auth';

/**
 * Starts a free trial. The owner check, the single-subscription rule and the
 * forced `trialing` status all live in `start_trial()` — this is only the
 * plumbing, because a check in a Server Action is not a check.
 */
export async function startTrial(planCode: string) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc('start_trial', {
    agency: ctx.agencyId,
    plan: planCode,
    days: 14,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/settings/plan');
  revalidatePath('/', 'layout');
}
