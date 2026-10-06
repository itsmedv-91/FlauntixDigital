'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertRole, getContext, logActivity } from '@/lib/auth';
import { MANAGER_ROLES, STAFF_ROLES } from '@/lib/constants';
import type { ApprovalDecision, ContentFormat, ContentStatus } from '@/lib/types';
import { csv, list, num, str } from '@/lib/utils';

const STATUSES: ContentStatus[] = [
  'idea',
  'in_progress',
  'internal_review',
  'client_approval',
  'changes_requested',
  'approved',
  'scheduled',
  'published',
  'archived',
];

const FORMATS: ContentFormat[] = ['static', 'carousel', 'reel', 'story', 'video', 'blog', 'email', 'ad', 'other'];

/** Splits a textarea of asset links on newlines or commas. */
function urls(fd: FormData, key: string): string[] {
  const raw = str(fd, key);
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function refresh(id?: string, clientId?: string | null) {
  revalidatePath('/content');
  revalidatePath('/dashboard');
  if (id) revalidatePath(`/content/${id}`);
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

function contentFields(fd: FormData) {
  const status = str(fd, 'status') as ContentStatus | null;
  const format = str(fd, 'format') as ContentFormat | null;
  return {
    client_id: str(fd, 'client_id'),
    project_id: str(fd, 'project_id'),
    title: str(fd, 'title'),
    caption: str(fd, 'caption'),
    hashtags: csv(fd, 'hashtags').map((h) => h.replace(/^#/, '')),
    platforms: list(fd, 'platforms'),
    format: format && FORMATS.includes(format) ? format : 'static',
    status: status && STATUSES.includes(status) ? status : 'idea',
    scheduled_date: str(fd, 'scheduled_date'),
    scheduled_time: str(fd, 'scheduled_time'),
    assignee_id: str(fd, 'assignee_id'),
    asset_urls: urls(fd, 'asset_urls'),
    notes: str(fd, 'notes'),
    max_revisions: num(fd, 'max_revisions'),
  };
}

export async function createContent(fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);
  const fields = contentFields(fd);
  if (!fields.title) throw new Error('Give the post a title.');
  if (!fields.client_id) throw new Error('Pick the client this content is for.');

  const { data, error } = await ctx.supabase
    .from('content_items')
    .insert({ ...fields, agency_id: ctx.agencyId, created_by: ctx.user.id })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'content', data.id, 'created', { title: fields.title });
  refresh(data.id, fields.client_id);

  const back = str(fd, 'redirect_to');
  if (back && back.startsWith('/')) redirect(back);
}

export async function updateContent(id: string, fd: FormData) {
  const ctx = await getContext();
  const fields = contentFields(fd);

  // Freelancers may only move their own item along, not rewrite the brief.
  if (!ctx.isStaff) {
    if (!fields.status) throw new Error('Invalid status.');
    const { error } = await ctx.supabase.from('content_items').update({ status: fields.status }).eq('id', id);
    if (error) throw new Error(error.message);
    refresh(id);
    return;
  }

  if (!fields.title) throw new Error('Give the post a title.');
  if (!fields.client_id) throw new Error('Pick the client this content is for.');
  const { error } = await ctx.supabase.from('content_items').update(fields).eq('id', id);
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'content', id, 'updated', { title: fields.title });
  refresh(id, fields.client_id);
}

/**
 * Board drag-and-drop. Dropping a card into "With client" sends it for
 * approval through the RPC, so the status and the approval round always agree.
 */
export async function moveContent(id: string, status: ContentStatus) {
  const ctx = await getContext();
  if (!STATUSES.includes(status)) return { error: 'Unknown status.' };

  if (status === 'client_approval') {
    const { error } = await ctx.supabase.rpc('request_content_approval', { item_id: id });
    if (error) return { error: error.message };
    refresh(id);
    return { ok: true };
  }

  const { data, error } = await ctx.supabase
    .from('content_items')
    .update({ status })
    .eq('id', id)
    .select('title, client_id')
    .maybeSingle();
  if (error || !data) return { error: error?.message ?? 'You cannot move this item.' };
  await logActivity(ctx, 'content', id, 'moved', { title: data.title, status });
  refresh(id, data.client_id);
  return { ok: true };
}

/** Calendar drag-and-drop: same item, new slot in the month. */
export async function rescheduleContent(id: string, date: string) {
  const ctx = await getContext();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Invalid date.' };
  const { data, error } = await ctx.supabase
    .from('content_items')
    .update({ scheduled_date: date })
    .eq('id', id)
    .select('title, client_id')
    .maybeSingle();
  if (error || !data) return { error: error?.message ?? 'You cannot reschedule this item.' };
  await logActivity(ctx, 'content', id, 'rescheduled', { title: data.title, date });
  refresh(id, data.client_id);
  return { ok: true };
}

/** Opens (or reuses) an approval round and puts the item in front of the client. */
export async function requestApproval(id: string) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);
  const { error } = await ctx.supabase.rpc('request_content_approval', { item_id: id });
  if (error) throw new Error(error.message);
  refresh(id);
}

/**
 * Records the client's answer. Until the client portal ships, this is a team
 * member entering a decision the client gave over WhatsApp or email — which is
 * why every row is stamped `on_behalf` and names the contact it came from.
 */
export async function recordDecision(approvalId: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);
  const decision = str(fd, 'decision') as ApprovalDecision | null;
  if (decision !== 'approved' && decision !== 'changes_requested') {
    throw new Error('Choose whether the client approved or asked for changes.');
  }
  const comment = str(fd, 'comment');
  if (decision === 'changes_requested' && !comment) {
    throw new Error('Note down what the client wants changed.');
  }

  const { error } = await ctx.supabase.rpc('decide_content_approval', {
    approval_id: approvalId,
    new_decision: decision,
    decision_comment: comment,
    contact_id: str(fd, 'contact_id'),
  });
  if (error) throw new Error(error.message);

  const itemId = str(fd, 'item_id');
  refresh(itemId ?? undefined);
}

export async function addContentComment(itemId: string, fd: FormData) {
  const ctx = await getContext();
  const body = str(fd, 'body');
  if (!body) throw new Error('Write something first.');
  const { error } = await ctx.supabase.from('content_comments').insert({
    agency_id: ctx.agencyId,
    content_item_id: itemId,
    author_id: ctx.user.id,
    body,
    visible_to_client: fd.get('visible_to_client') === 'on',
  });
  if (error) throw new Error(error.message);
  refresh(itemId);
}

export async function markPublished(id: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);
  const { data, error } = await ctx.supabase
    .from('content_items')
    .update({ status: 'published', published_url: str(fd, 'published_url') })
    .eq('id', id)
    .select('title, client_id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'content', id, 'published', { title: data?.title });
  refresh(id, data?.client_id);
}

/** Copies a post to a new date — the quickest way to build a recurring slot. */
export async function duplicateContent(id: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);
  const { data: src, error } = await ctx.supabase.from('content_items').select('*').eq('id', id).single();
  if (error || !src) throw new Error('Content not found.');

  const { data, error: insErr } = await ctx.supabase
    .from('content_items')
    .insert({
      agency_id: ctx.agencyId,
      client_id: src.client_id,
      project_id: src.project_id,
      title: src.title,
      caption: src.caption,
      hashtags: src.hashtags,
      platforms: src.platforms,
      format: src.format,
      status: 'idea',
      scheduled_date: str(fd, 'scheduled_date') ?? src.scheduled_date,
      scheduled_time: src.scheduled_time,
      assignee_id: src.assignee_id,
      asset_urls: src.asset_urls,
      notes: src.notes,
      max_revisions: src.max_revisions,
      created_by: ctx.user.id,
    })
    .select('id')
    .single();
  if (insErr) throw new Error(insErr.message);
  await logActivity(ctx, 'content', data.id, 'duplicated', { title: src.title, from: id });
  refresh(data.id, src.client_id);
  redirect(`/content/${data.id}`);
}

export async function deleteContent(id: string) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const { data } = await ctx.supabase.from('content_items').select('title, client_id').eq('id', id).maybeSingle();
  const { error } = await ctx.supabase.from('content_items').delete().eq('id', id);
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'content', id, 'deleted', { title: data?.title });
  refresh(undefined, data?.client_id);
  redirect('/content');
}
