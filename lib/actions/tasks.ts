'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertRole, getContext, logActivity } from '@/lib/auth';
import { STAFF_ROLES } from '@/lib/constants';
import type { TaskPriority, TaskStatus } from '@/lib/types';
import { csv, num, str } from '@/lib/utils';

const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'internal_review', 'client_approval', 'done'];
const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

async function clientForProject(ctx: Awaited<ReturnType<typeof getContext>>, projectId: string | null) {
  if (!projectId) return null;
  const { data } = await ctx.supabase.from('projects').select('client_id').eq('id', projectId).maybeSingle();
  return (data?.client_id as string | null) ?? null;
}

function revalidateTaskViews(projectId?: string | null, taskId?: string) {
  revalidatePath('/tasks');
  revalidatePath('/dashboard');
  if (projectId) revalidatePath(`/projects/${projectId}`);
  if (taskId) revalidatePath(`/tasks/${taskId}`);
}

export async function createTask(fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);
  const title = str(fd, 'title');
  if (!title) throw new Error('Task title is required.');

  const projectId = str(fd, 'project_id');
  const status = (str(fd, 'status') as TaskStatus) ?? 'todo';
  const priority = (str(fd, 'priority') as TaskPriority) ?? 'medium';
  const clientId = str(fd, 'client_id') ?? (await clientForProject(ctx, projectId));

  const { data, error } = await ctx.supabase
    .from('tasks')
    .insert({
      agency_id: ctx.agencyId,
      title,
      description: str(fd, 'description'),
      project_id: projectId,
      client_id: clientId,
      status: STATUSES.includes(status) ? status : 'todo',
      priority: PRIORITIES.includes(priority) ? priority : 'medium',
      assignee_id: str(fd, 'assignee_id'),
      due_date: str(fd, 'due_date'),
      estimate_hours: num(fd, 'estimate_hours'),
      max_revisions: num(fd, 'max_revisions'),
      tags: csv(fd, 'tags'),
      created_by: ctx.user.id,
      position: Date.now(),
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'task', data.id, 'created', { title });
  revalidateTaskViews(projectId);
  const back = str(fd, 'redirect_to');
  if (back && back.startsWith('/')) redirect(back);
}

export async function updateTask(id: string, fd: FormData) {
  const ctx = await getContext();
  const status = str(fd, 'status') as TaskStatus | null;

  // Freelancers may only move their own task through the workflow.
  if (!ctx.isStaff) {
    if (!status || !STATUSES.includes(status)) throw new Error('Invalid status.');
    const { error } = await ctx.supabase.from('tasks').update({ status }).eq('id', id);
    if (error) throw new Error(error.message);
    revalidateTaskViews(null, id);
    return;
  }

  const title = str(fd, 'title');
  if (!title) throw new Error('Task title is required.');
  const projectId = str(fd, 'project_id');
  const priority = str(fd, 'priority') as TaskPriority | null;
  const { error } = await ctx.supabase
    .from('tasks')
    .update({
      title,
      description: str(fd, 'description'),
      project_id: projectId,
      client_id: await clientForProject(ctx, projectId),
      status: status && STATUSES.includes(status) ? status : 'todo',
      priority: priority && PRIORITIES.includes(priority) ? priority : 'medium',
      assignee_id: str(fd, 'assignee_id'),
      due_date: str(fd, 'due_date'),
      estimate_hours: num(fd, 'estimate_hours'),
      max_revisions: num(fd, 'max_revisions'),
      tags: csv(fd, 'tags'),
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'task', id, 'updated', { title, status });
  revalidateTaskViews(projectId, id);
}

/** Called by the drag-and-drop board. */
export async function moveTask(id: string, status: TaskStatus, position: number) {
  const ctx = await getContext();
  if (!STATUSES.includes(status)) return { error: 'Invalid status.' };
  const { data, error } = await ctx.supabase
    .from('tasks')
    .update({ status, position })
    .eq('id', id)
    .select('title, project_id')
    .maybeSingle();
  if (error || !data) return { error: error?.message ?? 'You cannot move this task.' };
  await logActivity(ctx, 'task', id, 'moved', { title: data.title, status });
  revalidateTaskViews(data.project_id, id);
  return { ok: true };
}

export async function addRevision(id: string) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);
  const { data } = await ctx.supabase.from('tasks').select('revision_count, title').eq('id', id).single();
  const next = (data?.revision_count ?? 0) + 1;
  await ctx.supabase.from('tasks').update({ revision_count: next, status: 'in_progress' }).eq('id', id);
  await logActivity(ctx, 'task', id, 'revision', { title: data?.title, revision: next });
  revalidateTaskViews(null, id);
}

export async function addComment(taskId: string, fd: FormData) {
  const ctx = await getContext();
  const body = str(fd, 'body');
  if (!body) return;
  const { error } = await ctx.supabase.from('task_comments').insert({
    agency_id: ctx.agencyId,
    task_id: taskId,
    author_id: ctx.user.id,
    body,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/tasks/${taskId}`);
}

export async function deleteComment(taskId: string, commentId: string) {
  const ctx = await getContext();
  await ctx.supabase.from('task_comments').delete().eq('id', commentId);
  revalidatePath(`/tasks/${taskId}`);
}

export async function deleteTask(id: string) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);
  const { data } = await ctx.supabase.from('tasks').select('project_id, title').eq('id', id).maybeSingle();
  const { error } = await ctx.supabase.from('tasks').delete().eq('id', id);
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'task', id, 'deleted', { title: data?.title });
  revalidateTaskViews(data?.project_id);
  redirect(data?.project_id ? `/projects/${data.project_id}` : '/tasks');
}
