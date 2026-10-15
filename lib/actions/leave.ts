'use server';

import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/auth';
import { num, str } from '@/lib/utils';

function refresh() {
  revalidatePath('/leave');
  revalidatePath('/dashboard');
}

/**
 * Files leave for the signed-in person. The RPC enforces the rules that must
 * not depend on the UI: no overlapping request, and no more days than the
 * dates cover.
 */
export async function requestLeave(fd: FormData) {
  const ctx = await getContext();
  const from = str(fd, 'from_date');
  const to = str(fd, 'to_date');
  const days = num(fd, 'days');
  if (!from || !to) throw new Error('Pick the dates you are taking off.');
  if (days === null || days <= 0) throw new Error('Say how many days you are taking.');

  const { error } = await ctx.supabase.rpc('request_leave', {
    l_type: str(fd, 'leave_type') ?? 'Casual',
    from_d: from,
    to_d: to,
    n_days: days,
    l_reason: str(fd, 'reason'),
  });
  if (error) throw new Error(error.message);
  refresh();
}

/** Approve or reject. The RPC refuses to let anyone decide their own request. */
export async function decideLeave(id: string, fd: FormData) {
  const ctx = await getContext();
  const decision = str(fd, 'decision');
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new Error('Choose approve or reject.');
  }
  const { error } = await ctx.supabase.rpc('decide_leave', {
    request_id: id,
    decision,
    note: str(fd, 'decision_note'),
  });
  if (error) throw new Error(error.message);
  refresh();
}

export async function cancelLeave(id: string) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc('cancel_leave', { request_id: id });
  if (error) throw new Error(error.message);
  refresh();
}

export async function setLeaveAllowance(fy: string, fd: FormData) {
  const ctx = await getContext();
  const member = str(fd, 'member');
  const days = num(fd, 'days');
  const leaveType = str(fd, 'leave_type');
  if (!member) throw new Error('Choose whose allowance you are setting.');
  if (!leaveType) throw new Error('Pick a leave type.');
  if (days === null || days < 0) throw new Error('Enter the number of days.');

  const { error } = await ctx.supabase.rpc('set_leave_allowance', {
    member,
    the_fy: fy,
    l_type: leaveType,
    n_days: days,
  });
  if (error) throw new Error(error.message);
  refresh();
}
