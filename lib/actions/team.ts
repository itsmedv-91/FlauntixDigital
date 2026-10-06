'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertRole, getContext, logActivity } from '@/lib/auth';
import { ADMIN_ROLES, STAFF_ROLES } from '@/lib/constants';
import type { MemberRole } from '@/lib/types';
import { csv, num, str } from '@/lib/utils';

const INVITABLE: MemberRole[] = ['admin', 'manager', 'member', 'freelancer'];

export async function inviteMember(fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, ADMIN_ROLES);
  const email = str(fd, 'email')?.toLowerCase();
  const role = (str(fd, 'role') as MemberRole) ?? 'member';
  if (!email || !email.includes('@')) throw new Error('Enter a valid email.');
  if (!INVITABLE.includes(role)) throw new Error('Choose a role.');

  const { error } = await ctx.supabase.from('invitations').insert({
    agency_id: ctx.agencyId,
    email,
    role,
    invited_by: ctx.user.id,
  });
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'member', null, 'invited', { email, role });
  revalidatePath('/team');
}

export async function revokeInvite(id: string) {
  const ctx = await getContext();
  assertRole(ctx, ADMIN_ROLES);
  await ctx.supabase.from('invitations').delete().eq('id', id);
  revalidatePath('/team');
}

export async function changeRole(userId: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, ADMIN_ROLES);
  const role = str(fd, 'role') as MemberRole;
  if (!INVITABLE.includes(role)) throw new Error('Choose a role.');
  const { error } = await ctx.supabase
    .from('memberships')
    .update({ role, hourly_cost: num(fd, 'hourly_cost') })
    .eq('agency_id', ctx.agencyId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'member', userId, 'role_changed', { role });
  revalidatePath('/team');
}

/** Deactivating keeps their history but removes all access immediately. */
export async function setMemberActive(userId: string, active: boolean) {
  const ctx = await getContext();
  assertRole(ctx, ADMIN_ROLES);
  if (userId === ctx.user.id) throw new Error('You cannot deactivate yourself.');
  const { error } = await ctx.supabase
    .from('memberships')
    .update({ active })
    .eq('agency_id', ctx.agencyId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'member', userId, active ? 'reactivated' : 'deactivated');
  revalidatePath('/team');
}

export async function updateProfile(fd: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase
    .from('profiles')
    .update({
      full_name: str(fd, 'full_name'),
      job_title: str(fd, 'job_title'),
      skills: csv(fd, 'skills'),
    })
    .eq('id', ctx.user.id);
  if (error) throw new Error(error.message);
  revalidatePath('/', 'layout');
}

export async function changePassword(fd: FormData) {
  const ctx = await getContext();
  const password = str(fd, 'password');
  if (!password || password.length < 8) throw new Error('Use at least 8 characters.');
  const { error } = await ctx.supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
  redirect('/settings?saved=password');
}

export async function updateAgency(fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, ADMIN_ROLES);
  const name = str(fd, 'name');
  if (!name) throw new Error('Agency name is required.');
  const { error } = await ctx.supabase.from('agencies').update({ name }).eq('id', ctx.agencyId);
  if (error) throw new Error(error.message);
  revalidatePath('/', 'layout');
}

export async function createChannel(fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);
  const raw = str(fd, 'name');
  if (!raw) throw new Error('Channel name is required.');
  const name = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const { data, error } = await ctx.supabase
    .from('channels')
    .insert({
      agency_id: ctx.agencyId,
      name,
      kind: str(fd, 'kind') ?? 'department',
      client_id: str(fd, 'client_id'),
      created_by: ctx.user.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  revalidatePath('/chat', 'layout');
  redirect(`/chat/${data.id}`);
}

export async function inviteLink(token: string) {
  const h = await headers();
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ??
    `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
  return `${base}/invite/${token}`;
}
