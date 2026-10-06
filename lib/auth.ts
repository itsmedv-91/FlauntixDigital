import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ADMIN_ROLES, MANAGER_ROLES, STAFF_ROLES } from '@/lib/constants';
import type { Agency, MemberRole, Profile } from '@/lib/types';

export const AGENCY_COOKIE = 'flx_agency';

export interface AgencyMembership {
  agency_id: string;
  role: MemberRole;
  agency: Agency;
}

/**
 * Resolves the signed-in user, their profile and the agency they are working in.
 * Cached per request, so every server component and action can call it freely.
 */
export const getContext = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { data: rows }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase
      .from('memberships')
      .select('agency_id, role, agency:agencies(id, name, slug, created_at)')
      .eq('user_id', user.id)
      .eq('active', true)
      .order('created_at'),
  ]);

  const memberships = ((rows ?? []) as unknown as AgencyMembership[]).filter((m) => m.agency);
  if (memberships.length === 0) redirect('/onboarding');

  const preferred = (await cookies()).get(AGENCY_COOKIE)?.value;
  const current = memberships.find((m) => m.agency_id === preferred) ?? memberships[0];
  const role = current.role;

  return {
    supabase,
    user,
    profile: (profile ?? { id: user.id, email: user.email, full_name: null }) as Profile,
    agency: current.agency,
    agencyId: current.agency_id,
    role,
    memberships,
    isAdmin: ADMIN_ROLES.includes(role),
    isManager: MANAGER_ROLES.includes(role),
    isStaff: STAFF_ROLES.includes(role),
  };
});

export type AppContext = Awaited<ReturnType<typeof getContext>>;

export function assertRole(ctx: AppContext, roles: MemberRole[]) {
  if (!roles.includes(ctx.role)) {
    throw new Error('You do not have permission to do that.');
  }
}

export async function logActivity(
  ctx: AppContext,
  entityType: string,
  entityId: string | null,
  action: string,
  meta?: Record<string, unknown>,
) {
  await ctx.supabase.from('activity_log').insert({
    agency_id: ctx.agencyId,
    actor_id: ctx.user.id,
    entity_type: entityType,
    entity_id: entityId,
    action,
    meta: meta ?? null,
  });
}

/** Everyone in the current agency, for assignee pickers and name lookups. */
export const getTeam = cache(async () => {
  const ctx = await getContext();
  const { data } = await ctx.supabase
    .from('memberships')
    .select('user_id, role, active, profile:profiles(id, full_name, email, avatar_url, job_title)')
    .eq('agency_id', ctx.agencyId)
    .order('created_at');
  return ((data ?? []) as unknown as {
    user_id: string;
    role: MemberRole;
    active: boolean;
    profile: Profile | null;
  }[]).filter((m) => m.profile);
});
