'use server';

import { revalidatePath } from 'next/cache';
import { assertRole, getContext, logActivity } from '@/lib/auth';
import { MANAGER_ROLES } from '@/lib/constants';
import { num, str } from '@/lib/utils';
import type { AutomationAction, AutomationTrigger } from '@/lib/types';

function refresh() {
  revalidatePath('/automations');
}

export async function createRule(fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);

  const action = str(fd, 'action') as AutomationAction | null;
  const channelId = str(fd, 'channel_id');
  if (action === 'chat_message' && !channelId) {
    throw new Error('Choose the channel the message should go to.');
  }

  const { error } = await ctx.supabase.from('automation_rules').insert({
    agency_id: ctx.agencyId,
    name: str(fd, 'name') ?? 'Untitled automation',
    trigger: str(fd, 'trigger') as AutomationTrigger,
    threshold_days: num(fd, 'threshold_days') ?? 0,
    client_id: str(fd, 'client_id'),
    action,
    // Only kept for the action that uses it, so switching action later cannot
    // leave a stale channel or assignee behind.
    channel_id: action === 'chat_message' ? channelId : null,
    assignee_id: action === 'create_task' ? str(fd, 'assignee_id') : null,
    created_by: ctx.user.id,
  });
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'automation', null, 'created', { name: str(fd, 'name') });
  refresh();
}

export async function toggleRule(id: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const { error } = await ctx.supabase
    .from('automation_rules')
    .update({ active: fd.get('active') === '1' })
    .eq('id', id);
  if (error) throw new Error(error.message);
  refresh();
}

export async function deleteRule(id: string) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const { error } = await ctx.supabase.from('automation_rules').delete().eq('id', id);
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'automation', id, 'deleted');
  refresh();
}

/**
 * Runs every active rule now. Safe to press twice: the dedupe key in
 * `automation_events` means the second press acts on nothing.
 */
export async function runNow() {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const { error } = await ctx.supabase.rpc('run_automations', { agency: ctx.agencyId });
  if (error) throw new Error(error.message);
  revalidatePath('/automations');
  revalidatePath('/chat');
  revalidatePath('/tasks');
}
