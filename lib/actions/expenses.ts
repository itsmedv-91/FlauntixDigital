'use server';

import { revalidatePath } from 'next/cache';
import { assertRole, getContext, logActivity } from '@/lib/auth';
import { MANAGER_ROLES } from '@/lib/constants';
import { num, str } from '@/lib/utils';

function refresh(clientId?: string | null) {
  revalidatePath('/profitability');
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

/**
 * Records a cost that is not somebody's time: ad spend fronted for a client,
 * a freelancer invoice, tools, production.
 *
 * `rebilled` marks a cost passed on to the client. It stays counted as a cost
 * either way — the matching invoice line counts as revenue, so a pass-through
 * nets to zero margin rather than flattering it.
 */
export async function addExpense(fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);

  const description = str(fd, 'description');
  if (!description) throw new Error('Describe what the cost was for.');
  const amount = num(fd, 'amount');
  if (amount === null || amount < 0) throw new Error('Enter the amount.');

  const clientId = str(fd, 'client_id');
  const { error } = await ctx.supabase.from('expenses').insert({
    agency_id: ctx.agencyId,
    client_id: clientId,
    project_id: str(fd, 'project_id'),
    incurred_on: str(fd, 'incurred_on') ?? undefined,
    category: str(fd, 'category') ?? 'Other',
    description,
    amount,
    vendor: str(fd, 'vendor'),
    rebilled: fd.get('rebilled') === 'on',
    notes: str(fd, 'notes'),
    created_by: ctx.user.id,
  });
  if (error) throw new Error(error.message);

  await logActivity(ctx, 'expense', null, 'recorded', { description, amount });
  refresh(clientId);
}

export async function deleteExpense(id: string) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const { data } = await ctx.supabase
    .from('expenses')
    .select('description, client_id')
    .eq('id', id)
    .maybeSingle();
  const { error } = await ctx.supabase.from('expenses').delete().eq('id', id);
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'expense', id, 'deleted', { description: data?.description });
  refresh(data?.client_id);
}

/**
 * Sets a member's hourly cost. This is what makes the margin report mean
 * anything — unpriced time is reported as zero cost, so the report warns about
 * it rather than quietly flattering the numbers.
 *
 * Changing it only affects time logged from now on: `time_entries.cost_rate` is
 * snapshotted when the entry is written, so past months do not move.
 */
export async function setHourlyCost(userId: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const cost = num(fd, 'hourly_cost');
  if (cost !== null && cost < 0) throw new Error('An hourly cost cannot be negative.');

  // Through the RPC, not a direct update: `memberships_update` is admin-only and
  // refuses owner rows, so a direct write could never price the owner's time.
  const { error } = await ctx.supabase.rpc('set_hourly_cost', { member: userId, cost });
  if (error) throw new Error(error.message);

  revalidatePath('/profitability');
  revalidatePath('/team');
}
