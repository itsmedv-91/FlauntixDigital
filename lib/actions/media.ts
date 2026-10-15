'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertRole, getContext, logActivity } from '@/lib/auth';
import { MANAGER_ROLES } from '@/lib/constants';
import type { MediaPlanStatus } from '@/lib/types';
import { num, str } from '@/lib/utils';

const STATUSES: MediaPlanStatus[] = ['draft', 'shared', 'active', 'closed'];

function refresh(id?: string) {
  revalidatePath('/media-plans');
  if (id) revalidatePath(`/media-plans/${id}`);
}

export async function createMediaPlan(fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);

  const clientId = str(fd, 'client_id');
  const periodStart = str(fd, 'period_start');
  const periodEnd = str(fd, 'period_end');
  if (!clientId) throw new Error('Choose the client this plan is for.');
  if (!periodStart || !periodEnd) throw new Error('Set the period the plan covers.');
  if (periodEnd < periodStart) throw new Error('The end date is before the start date.');

  const { data, error } = await ctx.supabase
    .from('media_plans')
    .insert({
      agency_id: ctx.agencyId,
      client_id: clientId,
      name: str(fd, 'name') ?? 'Media plan',
      period_start: periodStart,
      period_end: periodEnd,
      objective: str(fd, 'objective'),
      notes: str(fd, 'notes'),
      created_by: ctx.user.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'media_plan', data.id, 'created', { client_id: clientId });
  refresh(data.id);
  redirect(`/media-plans/${data.id}`);
}

export async function updateMediaPlan(id: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const status = str(fd, 'status') as MediaPlanStatus | null;
  const { error } = await ctx.supabase
    .from('media_plans')
    .update({
      name: str(fd, 'name') ?? undefined,
      status: status && STATUSES.includes(status) ? status : undefined,
      objective: str(fd, 'objective'),
      notes: str(fd, 'notes'),
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
  refresh(id);
}

/**
 * Adds or updates one channel-month budget. The month is normalised to its
 * first day by a trigger, and (plan, channel, month) is unique, so entering
 * the same slot twice corrects it rather than creating a duplicate.
 */
export async function setPlanLine(planId: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);

  const channel = str(fd, 'channel');
  const month = str(fd, 'month');
  const planned = num(fd, 'planned');
  if (!channel) throw new Error('Pick a channel.');
  if (!month) throw new Error('Pick the month.');
  if (planned === null || planned < 0) throw new Error('Enter the planned budget.');

  const { error } = await ctx.supabase.from('media_plan_lines').upsert(
    {
      agency_id: ctx.agencyId,
      plan_id: planId,
      channel,
      month,
      planned,
      objective: str(fd, 'objective'),
      notes: str(fd, 'notes'),
    },
    { onConflict: 'plan_id,channel,month' },
  );
  if (error) throw new Error(error.message);
  refresh(planId);
}

export async function deletePlanLine(planId: string, lineId: string) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const { error } = await ctx.supabase.from('media_plan_lines').delete().eq('id', lineId);
  if (error) throw new Error(error.message);
  refresh(planId);
}

export async function deleteMediaPlan(id: string) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const { error } = await ctx.supabase.from('media_plans').delete().eq('id', id);
  if (error) throw new Error(error.message);
  refresh();
  redirect('/media-plans');
}
