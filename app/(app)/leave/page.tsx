import { getContext, getTeam } from '@/lib/auth';
import { cancelLeave, decideLeave, requestLeave, setLeaveAllowance } from '@/lib/actions/leave';
import { LEAVE_STATUSES, LEAVE_TYPES } from '@/lib/constants';
import type { LeaveBalance, LeaveRequest } from '@/lib/types';
import { SubmitButton } from '@/components/submit-button';
import { Avatar, Badge, Card, CardHeader, Disclosure, EmptyState, Field, Input, PageHeader, Select, Stat, Textarea } from '@/components/ui';
import { addDays, cn, displayName, formatDate, todayIST } from '@/lib/utils';
import { financialYear } from '@/lib/gst';

export const metadata = { title: 'Leave' };

export default async function LeavePage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const today = todayIST();
  const fy = /^\d{2}-\d{2}$/.test(sp.fy ?? '') ? sp.fy! : financialYear(today);

  const [{ data: requestRows }, team, balanceRes] = await Promise.all([
    ctx.supabase
      .from('leave_requests')
      .select('*, person:profiles(id, full_name, email)')
      .eq('agency_id', ctx.agencyId)
      .order('from_date', { ascending: false })
      .limit(300),
    getTeam(),
    ctx.isManager
      ? ctx.supabase.rpc('leave_balances', { agency: ctx.agencyId, the_fy: fy })
      : Promise.resolve({ data: null, error: null }),
  ]);

  const requests = (requestRows ?? []) as unknown as (LeaveRequest & {
    person: { id: string; full_name: string | null; email: string | null } | null;
  })[];
  const balances = ((balanceRes?.data ?? []) as unknown as LeaveBalance[]).map((b) => ({
    ...b,
    allowance: Number(b.allowance),
    taken: Number(b.taken),
    pending: Number(b.pending),
    remaining: Number(b.remaining),
  }));

  const mine = requests.filter((r) => r.user_id === ctx.user.id);
  const pending = requests.filter((r) => r.status === 'pending');
  // Approved leave overlapping the next fortnight — the thing a manager
  // actually needs to see before promising a client a deadline.
  const horizon = addDays(today, 14);
  const upcoming = requests.filter(
    (r) => r.status === 'approved' && r.to_date >= today && r.from_date <= horizon,
  );
  const myBalance = balances.filter((b) => b.user_id === ctx.user.id);

  return (
    <>
      <PageHeader title="Leave" subtitle={`Financial year ${fy}`} />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Your requests" value={mine.length} />
        <Stat
          label="Awaiting approval"
          value={pending.length}
          tone={ctx.isManager && pending.length ? 'warn' : undefined}
        />
        <Stat label="Off in the next 2 weeks" value={upcoming.length} />
        <Stat
          label="Your days left"
          value={myBalance.length ? myBalance.reduce((s, b) => s + b.remaining, 0) : '—'}
          hint={myBalance.length ? 'Across all types' : 'Managers can see balances'}
        />
      </div>

      <div className="mb-5">
        <Disclosure summary="Request leave">
          <form action={requestLeave} className="grid gap-4 sm:grid-cols-2">
            <Field label="Type">
              <Select name="leave_type" defaultValue="Casual">
                {LEAVE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Days" hint="Half days allowed, e.g. 0.5">
              <Input name="days" type="number" min="0.5" step="0.5" required defaultValue="1" />
            </Field>
            <Field label="From">
              <Input name="from_date" type="date" required defaultValue={today} />
            </Field>
            <Field label="To">
              <Input name="to_date" type="date" required defaultValue={today} />
            </Field>
            <Field label="Reason" className="sm:col-span-2">
              <Textarea name="reason" rows={2} placeholder="Optional, but it helps whoever covers for you" />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton>Request leave</SubmitButton>
              <p className="mt-2 text-xs text-zinc-500">
                Days can be fewer than the dates span, for weekends and half days. Overlapping requests are refused.
              </p>
            </div>
          </form>
        </Disclosure>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          {ctx.isManager && (
            <Card>
              <CardHeader
                title="Awaiting your approval"
                subtitle="Nobody can approve their own request, including you"
              />
              {pending.length === 0 ? (
                <p className="px-5 py-4 text-sm text-zinc-500">Nothing waiting.</p>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {pending.map((r) => {
                    const isOwn = r.user_id === ctx.user.id;
                    return (
                      <li key={r.id} className="px-5 py-3.5">
                        <div className="flex flex-wrap items-center gap-3">
                          <Avatar person={r.person} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-ink">
                              {displayName(r.person)}
                              <span className="ml-2 font-normal text-zinc-500">
                                {r.days} {r.days === 1 ? 'day' : 'days'} {r.leave_type.toLowerCase()}
                              </span>
                            </span>
                            <span className="block text-xs text-zinc-500">
                              {formatDate(r.from_date)} – {formatDate(r.to_date, true)}
                              {r.reason ? ` · ${r.reason}` : ''}
                            </span>
                          </span>
                        </div>
                        {isOwn ? (
                          <p className="mt-2 text-xs text-zinc-500">
                            This is your own request — somebody else has to decide it.
                          </p>
                        ) : (
                          <form action={decideLeave.bind(null, r.id)} className="mt-2 flex flex-wrap items-end gap-2">
                            <Select name="decision" defaultValue="approved" className="w-auto py-1.5 text-xs">
                              <option value="approved">Approve</option>
                              <option value="rejected">Reject</option>
                            </Select>
                            <Input name="decision_note" placeholder="Note (optional)" className="w-44 py-1.5 text-xs" />
                            <SubmitButton variant="secondary" size="sm" pendingText="…">Decide</SubmitButton>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}

          <Card>
            <CardHeader title="Who is off" subtitle="Approved leave, next two weeks" />
            {upcoming.length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-500">Everybody is in.</p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {upcoming.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                    <Avatar person={r.person} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-ink">{displayName(r.person)}</span>
                      <span className="block text-xs text-zinc-500">
                        {formatDate(r.from_date)} – {formatDate(r.to_date, true)} · {r.leave_type}
                      </span>
                    </span>
                    {r.from_date <= today && <Badge className="bg-amber-100 text-amber-800">Off now</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Your leave" subtitle={`${mine.length} request${mine.length === 1 ? '' : 's'}`} />
            {mine.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No leave requested" body="Use the form above when you need time off." />
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {mine.map((r) => {
                  const st = LEAVE_STATUSES.find((s) => s.value === r.status);
                  return (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-ink">
                          {r.days} {r.days === 1 ? 'day' : 'days'} {r.leave_type.toLowerCase()}
                        </span>
                        <span className="block text-xs text-zinc-500">
                          {formatDate(r.from_date)} – {formatDate(r.to_date, true)}
                          {r.decision_note ? ` · “${r.decision_note}”` : ''}
                        </span>
                      </span>
                      <Badge className={st?.tone}>{st?.label}</Badge>
                      {(r.status === 'pending' || r.status === 'approved') && (
                        <form action={cancelLeave.bind(null, r.id)}>
                          <button className="text-xs text-zinc-400 hover:text-red-600">Withdraw</button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {myBalance.length > 0 && (
            <Card>
              <CardHeader title="Your balance" subtitle={`FY ${fy}`} />
              <ul className="divide-y divide-zinc-100">
                {myBalance.map((b) => (
                  <li key={b.leave_type} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="text-zinc-700">{b.leave_type}</span>
                    <span className="tabular-nums text-zinc-600">
                      <span className={cn('font-medium', b.remaining <= 0 ? 'text-coral-500' : 'text-ink')}>{b.remaining}</span>
                      <span className="text-zinc-400"> / {b.allowance}</span>
                      {b.pending > 0 && <span className="ml-1 text-xs text-amber-700">({b.pending} pending)</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {ctx.isManager && (
            <Card className="overflow-x-auto">
              <CardHeader title="Team balances" subtitle="Allowance, taken and left" />
              {balances.length === 0 ? (
                <p className="px-5 py-4 text-sm text-zinc-500">
                  No allowances set yet. Grant days below and balances appear.
                </p>
              ) : (
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500">
                      <th className="px-5 py-2.5 font-medium">Member</th>
                      <th className="px-3 py-2.5 font-medium">Type</th>
                      <th className="px-3 py-2.5 text-right font-medium">Taken</th>
                      <th className="px-5 py-2.5 text-right font-medium">Left</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {balances.map((b) => (
                      <tr key={`${b.user_id}-${b.leave_type}`}>
                        <td className="px-5 py-2.5 text-ink">{b.full_name ?? '—'}</td>
                        <td className="px-3 py-2.5 text-zinc-600">{b.leave_type}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600">
                          {b.taken}
                          {b.pending > 0 && <span className="text-xs text-amber-700"> +{b.pending}</span>}
                        </td>
                        <td className={cn('px-5 py-2.5 text-right tabular-nums', b.remaining <= 0 ? 'text-coral-500' : 'text-ink')}>
                          {b.remaining} / {b.allowance}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="border-t border-zinc-100 p-5">
                <Disclosure summary="Grant leave days">
                  <form action={setLeaveAllowance.bind(null, fy)} className="space-y-3">
                    <Field label="Member">
                      <Select name="member" required defaultValue="">
                        <option value="">Choose…</option>
                        {team.filter((m) => m.active).map((m) => (
                          <option key={m.user_id} value={m.user_id}>{displayName(m.profile)}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Type">
                      <Select name="leave_type" defaultValue="Casual">
                        {LEAVE_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={`Days for FY ${fy}`}>
                      <Input name="days" type="number" min="0" step="0.5" required />
                    </Field>
                    <SubmitButton size="sm">Set allowance</SubmitButton>
                  </form>
                </Disclosure>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
