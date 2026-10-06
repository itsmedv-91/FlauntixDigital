import { notFound } from 'next/navigation';
import { getContext } from '@/lib/auth';
import { changeRole, inviteLink, inviteMember, revokeInvite, setMemberActive } from '@/lib/actions/team';
import { ROLES } from '@/lib/constants';
import type { MemberRole, Profile } from '@/lib/types';
import { CopyLink } from '@/components/copy-link';
import { SubmitButton } from '@/components/submit-button';
import { Avatar, Badge, Card, CardHeader, Disclosure, Field, Input, PageHeader, Select, Stat } from '@/components/ui';
import { cn, displayName, formatDate, formatMinutes, weekStartIST } from '@/lib/utils';

export const metadata = { title: 'Team' };

const INVITABLE = ROLES.filter((r) => r.value !== 'owner');

export default async function TeamPage() {
  const ctx = await getContext();
  if (!ctx.isStaff) notFound();
  const weekStart = weekStartIST();

  const [{ data: memberRows }, { data: taskRows }, { data: timeRows }, { data: inviteRows }] = await Promise.all([
    ctx.supabase
      .from('memberships')
      .select('id, user_id, role, active, hourly_cost, created_at, profile:profiles(id, full_name, email, avatar_url, job_title, skills)')
      .eq('agency_id', ctx.agencyId)
      .order('created_at'),
    ctx.supabase.from('tasks').select('assignee_id, status').eq('agency_id', ctx.agencyId).neq('status', 'done'),
    ctx.isManager
      ? ctx.supabase
          .from('time_entries')
          .select('user_id, minutes')
          .eq('agency_id', ctx.agencyId)
          .gte('started_at', `${weekStart}T00:00:00+05:30`)
      : Promise.resolve({ data: [] as { user_id: string; minutes: number | null }[] }),
    ctx.isAdmin
      ? ctx.supabase
          .from('invitations')
          .select('id, email, role, token, expires_at, created_at')
          .eq('agency_id', ctx.agencyId)
          .is('accepted_at', null)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as { id: string; email: string; role: MemberRole; token: string; expires_at: string; created_at: string }[] }),
  ]);

  const members = ((memberRows ?? []) as unknown as {
    id: string;
    user_id: string;
    role: MemberRole;
    active: boolean;
    hourly_cost: number | null;
    created_at: string;
    profile: Profile | null;
  }[]).filter((m) => m.profile);

  const openTasks = new Map<string, number>();
  for (const t of (taskRows ?? []) as { assignee_id: string | null }[]) {
    if (t.assignee_id) openTasks.set(t.assignee_id, (openTasks.get(t.assignee_id) ?? 0) + 1);
  }
  const weekMinutes = new Map<string, number>();
  for (const e of (timeRows ?? []) as { user_id: string; minutes: number | null }[]) {
    weekMinutes.set(e.user_id, (weekMinutes.get(e.user_id) ?? 0) + (e.minutes ?? 0));
  }

  const invites = (inviteRows ?? []) as {
    id: string;
    email: string;
    role: MemberRole;
    token: string;
    expires_at: string;
    created_at: string;
  }[];
  const links = await Promise.all(invites.map((i) => inviteLink(i.token)));
  const active = members.filter((m) => m.active);

  return (
    <>
      <PageHeader
        title="Team"
        subtitle={`${active.length} active ${active.length === 1 ? 'person' : 'people'} in ${ctx.agency.name}`}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active members" value={active.length} />
        <Stat label="Freelancers" value={active.filter((m) => m.role === 'freelancer').length} />
        <Stat label="Open tasks" value={[...openTasks.values()].reduce((s, n) => s + n, 0)} />
        {ctx.isManager && (
          <Stat label="Hours this week" value={formatMinutes([...weekMinutes.values()].reduce((s, n) => s + n, 0))} />
        )}
      </div>

      {ctx.isAdmin && (
        <div className="mb-5">
          <Disclosure summary="Invite someone">
            <form action={inviteMember} className="grid gap-4 sm:grid-cols-[2fr,1fr,auto] sm:items-end">
              <Field label="Email" hint="Must match the email they sign up with">
                <Input name="email" type="email" required placeholder="name@example.com" />
              </Field>
              <Field label="Role">
                <Select name="role" defaultValue="member">
                  {INVITABLE.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </Select>
              </Field>
              <SubmitButton pendingText="Creating…">Create invite</SubmitButton>
            </form>
            <p className="mt-3 text-xs text-zinc-500">
              No emails are sent yet — copy the invite link below and share it over WhatsApp or email.
            </p>
          </Disclosure>
        </div>
      )}

      <Card className="overflow-x-auto">
        <CardHeader title="Members" subtitle={ctx.isAdmin ? 'Change a role or hourly cost and press Save' : undefined} />
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500">
              <th className="px-5 py-3 font-medium">Member</th>
              <th className="px-3 py-3 font-medium">Role</th>
              <th className="px-3 py-3 font-medium">Open tasks</th>
              {ctx.isManager && <th className="px-3 py-3 font-medium">Hours this week</th>}
              <th className="px-3 py-3 font-medium">Joined</th>
              {ctx.isAdmin && <th className="px-5 py-3 font-medium">Manage</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {members.map((m) => {
              const role = ROLES.find((r) => r.value === m.role);
              const self = m.user_id === ctx.user.id;
              // Owners can never be demoted, and nobody can change their own role.
              const editable = ctx.isAdmin && !self && m.role !== 'owner';
              return (
                <tr key={m.user_id} className={cn('align-top hover:bg-zinc-50', !m.active && 'opacity-60')}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar person={m.profile} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">
                          {displayName(m.profile)}
                          {self && <span className="ml-1.5 text-xs font-normal text-zinc-400">you</span>}
                        </p>
                        <p className="truncate text-xs text-zinc-500">{m.profile?.job_title ?? m.profile?.email ?? '—'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Badge className={m.role === 'freelancer' ? 'bg-amber-100 text-amber-800' : 'bg-brand-100 text-brand-800'}>
                      {role?.label ?? m.role}
                    </Badge>
                    {!m.active && <Badge className="ml-1.5 bg-zinc-200 text-zinc-600">Inactive</Badge>}
                  </td>
                  <td className="px-3 py-3 tabular-nums">{openTasks.get(m.user_id) ?? 0}</td>
                  {ctx.isManager && <td className="px-3 py-3 tabular-nums">{formatMinutes(weekMinutes.get(m.user_id) ?? 0)}</td>}
                  <td className="px-3 py-3 text-zinc-500">{formatDate(m.created_at, true)}</td>
                  {ctx.isAdmin && (
                    <td className="px-5 py-3">
                      {editable ? (
                        <div className="flex flex-wrap items-end gap-2">
                          <form action={changeRole.bind(null, m.user_id)} className="flex items-end gap-2">
                            <Select name="role" defaultValue={m.role} className="w-auto py-1.5 text-xs">
                              {INVITABLE.map((r) => (
                                <option key={r.value} value={r.value}>{r.label}</option>
                              ))}
                            </Select>
                            <Input
                              name="hourly_cost"
                              type="number"
                              min="0"
                              step="50"
                              defaultValue={m.hourly_cost ?? ''}
                              placeholder="₹/hr"
                              className="w-24 py-1.5 text-xs"
                            />
                            <SubmitButton variant="secondary" size="sm" pendingText="…">Save</SubmitButton>
                          </form>
                          <form action={setMemberActive.bind(null, m.user_id, !m.active)}>
                            <SubmitButton
                              variant={m.active ? 'danger' : 'secondary'}
                              size="sm"
                              pendingText="…"
                              confirm={m.active ? `Deactivate ${displayName(m.profile)}? They lose access immediately.` : undefined}
                            >
                              {m.active ? 'Deactivate' : 'Reactivate'}
                            </SubmitButton>
                          </form>
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-400">{m.role === 'owner' ? 'Owner — cannot be changed' : '—'}</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {ctx.isAdmin && (
        <Card className="mt-5">
          <CardHeader title="Pending invites" subtitle="Share the link with the person you invited" />
          {invites.length === 0 ? (
            <p className="px-5 py-4 text-sm text-zinc-500">No pending invites.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {invites.map((i, idx) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{i.email}</p>
                    <p className="text-xs text-zinc-500">
                      {ROLES.find((r) => r.value === i.role)?.label} · expires {formatDate(i.expires_at, true)}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1"><CopyLink url={links[idx]} /></div>
                  <form action={revokeInvite.bind(null, i.id)}>
                    <SubmitButton variant="ghost" size="sm" confirm="Revoke this invite?" pendingText="…">Revoke</SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
