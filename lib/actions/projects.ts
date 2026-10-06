'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertRole, getContext, logActivity } from '@/lib/auth';
import { ADMIN_ROLES, MANAGER_ROLES } from '@/lib/constants';
import { num, str } from '@/lib/utils';

function projectFields(fd: FormData) {
  return {
    name: str(fd, 'name'),
    client_id: str(fd, 'client_id'),
    description: str(fd, 'description'),
    status: str(fd, 'status') ?? 'planning',
    start_date: str(fd, 'start_date'),
    due_date: str(fd, 'due_date'),
    budget: num(fd, 'budget'),
    owner_id: str(fd, 'owner_id'),
  };
}

export async function createProject(fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const fields = projectFields(fd);
  if (!fields.name) throw new Error('Project name is required.');
  const { data, error } = await ctx.supabase
    .from('projects')
    .insert({ ...fields, owner_id: fields.owner_id ?? ctx.user.id, agency_id: ctx.agencyId })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'project', data.id, 'created', { name: fields.name });
  revalidatePath('/projects');
  if (fields.client_id) revalidatePath(`/clients/${fields.client_id}`);
  redirect(`/projects/${data.id}`);
}

export async function updateProject(id: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const fields = projectFields(fd);
  if (!fields.name) throw new Error('Project name is required.');
  const { error } = await ctx.supabase.from('projects').update(fields).eq('id', id);
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'project', id, 'updated', { name: fields.name, status: fields.status });
  revalidatePath(`/projects/${id}`);
  redirect(`/projects/${id}`);
}

export async function deleteProject(id: string) {
  const ctx = await getContext();
  assertRole(ctx, ADMIN_ROLES);
  const { error } = await ctx.supabase.from('projects').delete().eq('id', id);
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'project', id, 'deleted');
  revalidatePath('/projects');
  redirect('/projects');
}
