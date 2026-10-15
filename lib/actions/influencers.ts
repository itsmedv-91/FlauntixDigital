'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertRole, getContext, logActivity } from '@/lib/auth';
import { MANAGER_ROLES } from '@/lib/constants';
import { csv, num, str } from '@/lib/utils';
import type { CollabStatus, InfluencerStatus } from '@/lib/types';

function refresh(id?: string) {
  revalidatePath('/influencers');
  if (id) revalidatePath(`/influencers/${id}`);
}

export async function createInfluencer(fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const name = str(fd, 'name');
  if (!name) throw new Error('Give the influencer a name.');

  const { data, error } = await ctx.supabase
    .from('influencers')
    .insert({
      agency_id: ctx.agencyId,
      name,
      handle: str(fd, 'handle'),
      platform: str(fd, 'platform') ?? 'Instagram',
      profile_url: str(fd, 'profile_url'),
      followers: num(fd, 'followers'),
      engagement_rate: num(fd, 'engagement_rate'),
      niches: csv(fd, 'niches'),
      city: str(fd, 'city'),
      email: str(fd, 'email'),
      phone: str(fd, 'phone'),
      rate_card: num(fd, 'rate_card'),
      status: (str(fd, 'status') ?? 'prospect') as InfluencerStatus,
      notes: str(fd, 'notes'),
      created_by: ctx.user.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'influencer', data.id, 'created', { name });
  refresh();
  redirect(`/influencers/${data.id}`);
}

export async function updateInfluencer(id: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const { error } = await ctx.supabase
    .from('influencers')
    .update({
      name: str(fd, 'name') ?? undefined,
      handle: str(fd, 'handle'),
      platform: str(fd, 'platform') ?? undefined,
      profile_url: str(fd, 'profile_url'),
      followers: num(fd, 'followers'),
      engagement_rate: num(fd, 'engagement_rate'),
      niches: csv(fd, 'niches'),
      city: str(fd, 'city'),
      email: str(fd, 'email'),
      phone: str(fd, 'phone'),
      rate_card: num(fd, 'rate_card'),
      status: (str(fd, 'status') ?? undefined) as InfluencerStatus | undefined,
      notes: str(fd, 'notes'),
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
  refresh(id);
}

export async function deleteInfluencer(id: string) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const { error } = await ctx.supabase.from('influencers').delete().eq('id', id);
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'influencer', id, 'deleted');
  refresh();
  redirect('/influencers');
}

export async function createCollab(influencerId: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const clientId = str(fd, 'client_id');
  if (!clientId) throw new Error('Choose the client this collaboration is for.');

  const { error } = await ctx.supabase.from('influencer_collabs').insert({
    agency_id: ctx.agencyId,
    influencer_id: influencerId,
    client_id: clientId,
    project_id: str(fd, 'project_id'),
    title: str(fd, 'title') ?? 'Collaboration',
    deliverables: str(fd, 'deliverables'),
    fee: num(fd, 'fee') ?? 0,
    brief_url: str(fd, 'brief_url'),
    go_live_on: str(fd, 'go_live_on'),
    created_by: ctx.user.id,
  });
  if (error) throw new Error(error.message);
  refresh(influencerId);
}

export async function updateCollab(id: string, influencerId: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const { error } = await ctx.supabase
    .from('influencer_collabs')
    .update({
      title: str(fd, 'title') ?? undefined,
      deliverables: str(fd, 'deliverables'),
      fee: num(fd, 'fee') ?? undefined,
      brief_url: str(fd, 'brief_url'),
      live_url: str(fd, 'live_url'),
      go_live_on: str(fd, 'go_live_on'),
      status: (str(fd, 'status') ?? undefined) as CollabStatus | undefined,
      notes: str(fd, 'notes'),
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
  refresh(influencerId);
}

export async function deleteCollab(id: string, influencerId: string) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const { error } = await ctx.supabase.from('influencer_collabs').delete().eq('id', id);
  if (error) throw new Error(error.message);
  refresh(influencerId);
}

/**
 * Books the fee as a client expense. The RPC does both writes and refuses a
 * second call, so the margin cannot be charged twice for one collaboration.
 */
export async function bookCollabFee(id: string, influencerId: string) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const { error } = await ctx.supabase.rpc('book_collab_fee', { collab_id: id });
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'influencer_collab', id, 'fee booked');
  refresh(influencerId);
  revalidatePath('/profitability');
}
