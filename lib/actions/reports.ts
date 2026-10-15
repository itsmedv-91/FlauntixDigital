'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertRole, getContext, logActivity } from '@/lib/auth';
import { MANAGER_ROLES, STAFF_ROLES } from '@/lib/constants';
import { str } from '@/lib/utils';

function refresh(id?: string) {
  revalidatePath('/reports');
  if (id) {
    revalidatePath(`/reports/${id}`);
    revalidatePath(`/reports/${id}/print`);
  }
}

export async function createReport(fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);

  const clientId = str(fd, 'client_id');
  const periodStart = str(fd, 'period_start');
  const periodEnd = str(fd, 'period_end');
  if (!clientId) throw new Error('Choose the client this report is for.');
  if (!periodStart || !periodEnd) throw new Error('Set the period the report covers.');
  if (periodEnd < periodStart) throw new Error('The end date is before the start date.');

  const { data, error } = await ctx.supabase
    .from('client_reports')
    .insert({
      agency_id: ctx.agencyId,
      client_id: clientId,
      period_start: periodStart,
      period_end: periodEnd,
      title: str(fd, 'title') ?? 'Client report',
      created_by: ctx.user.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  // Fill the figures straight away so there is something to look at.
  await ctx.supabase.rpc('build_client_report', { report_id: data.id });
  await logActivity(ctx, 'report', data.id, 'created', { client_id: clientId });
  refresh(data.id);
  redirect(`/reports/${data.id}`);
}

/** Recomputes the figures from live data. Refused once the report is sent. */
export async function rebuildReport(id: string) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);
  const { error } = await ctx.supabase.rpc('build_client_report', { report_id: id });
  if (error) throw new Error(error.message);
  refresh(id);
}

/** The numbers alone are not a report, so this is where the commentary goes. */
export async function updateReport(id: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);
  const { error } = await ctx.supabase
    .from('client_reports')
    .update({
      title: str(fd, 'title') ?? undefined,
      summary: str(fd, 'summary'),
      next_steps: str(fd, 'next_steps'),
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
  refresh(id);
}

/** Freezes the report and makes it visible in the client's portal. */
export async function sendReport(id: string) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const { error } = await ctx.supabase.rpc('send_client_report', { report_id: id });
  if (error) throw new Error(error.message);
  refresh(id);
  revalidatePath('/portal');
}

export async function deleteReport(id: string) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const { data } = await ctx.supabase.from('client_reports').select('status').eq('id', id).maybeSingle();
  if (data?.status === 'sent') {
    throw new Error('A sent report cannot be deleted — it is the record of what the client was told.');
  }
  const { error } = await ctx.supabase.from('client_reports').delete().eq('id', id);
  if (error) throw new Error(error.message);
  refresh();
  redirect('/reports');
}
