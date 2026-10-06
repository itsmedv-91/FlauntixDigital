'use server';

import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/auth';
import { num, str } from '@/lib/utils';

function refresh() {
  revalidatePath('/time');
  revalidatePath('/dashboard');
  revalidatePath('/tasks', 'layout');
}

/** Starts a timer, stopping any timer already running for this user. */
export async function startTimer(fd: FormData) {
  const ctx = await getContext();
  await stopRunning(ctx);

  const taskId = str(fd, 'task_id');
  let projectId: string | null = null;
  let clientId: string | null = null;
  if (taskId) {
    const { data } = await ctx.supabase.from('tasks').select('project_id, client_id').eq('id', taskId).maybeSingle();
    projectId = data?.project_id ?? null;
    clientId = data?.client_id ?? null;
  }
  const { error } = await ctx.supabase.from('time_entries').insert({
    agency_id: ctx.agencyId,
    user_id: ctx.user.id,
    task_id: taskId,
    project_id: projectId,
    client_id: clientId,
    note: str(fd, 'note'),
    started_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  refresh();
}

async function stopRunning(ctx: Awaited<ReturnType<typeof getContext>>) {
  const { data: running } = await ctx.supabase
    .from('time_entries')
    .select('id, started_at')
    .eq('user_id', ctx.user.id)
    .is('ended_at', null);
  const now = new Date();
  for (const e of running ?? []) {
    const minutes = Math.max(1, Math.round((now.getTime() - new Date(e.started_at).getTime()) / 60000));
    await ctx.supabase.from('time_entries').update({ ended_at: now.toISOString(), minutes }).eq('id', e.id);
  }
}

export async function stopTimer() {
  const ctx = await getContext();
  await stopRunning(ctx);
  refresh();
}

export async function addManualEntry(fd: FormData) {
  const ctx = await getContext();
  const date = str(fd, 'date');
  const hours = num(fd, 'hours') ?? 0;
  const mins = num(fd, 'minutes') ?? 0;
  const minutes = Math.round(hours * 60 + mins);
  if (!date || minutes <= 0) throw new Error('Enter a date and a duration.');
  if (minutes > 24 * 60) throw new Error('A single entry cannot exceed 24 hours.');

  const taskId = str(fd, 'task_id');
  let projectId = str(fd, 'project_id');
  let clientId: string | null = null;
  if (taskId) {
    const { data } = await ctx.supabase.from('tasks').select('project_id, client_id').eq('id', taskId).maybeSingle();
    projectId = data?.project_id ?? projectId;
    clientId = data?.client_id ?? null;
  } else if (projectId) {
    const { data } = await ctx.supabase.from('projects').select('client_id').eq('id', projectId).maybeSingle();
    clientId = data?.client_id ?? null;
  }

  // Store at 10:00 IST on the chosen day.
  const startedAt = new Date(`${date}T10:00:00+05:30`);
  const { error } = await ctx.supabase.from('time_entries').insert({
    agency_id: ctx.agencyId,
    user_id: ctx.user.id,
    task_id: taskId,
    project_id: projectId,
    client_id: clientId,
    started_at: startedAt.toISOString(),
    ended_at: new Date(startedAt.getTime() + minutes * 60000).toISOString(),
    minutes,
    note: str(fd, 'note'),
    billable: fd.get('billable') === 'on',
  });
  if (error) throw new Error(error.message);
  refresh();
}

export async function deleteTimeEntry(id: string) {
  const ctx = await getContext();
  await ctx.supabase.from('time_entries').delete().eq('id', id);
  refresh();
}
