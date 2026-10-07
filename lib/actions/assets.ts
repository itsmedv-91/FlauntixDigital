'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertRole, getContext, logActivity } from '@/lib/auth';
import { ASSET_BUCKET, MANAGER_ROLES, STAFF_ROLES } from '@/lib/constants';
import type { AssetKind } from '@/lib/types';
import { csv, str } from '@/lib/utils';

const KINDS: AssetKind[] = [
  'logo',
  'brand_guide',
  'font',
  'colour_palette',
  'image',
  'video',
  'document',
  'template',
  'other',
];

function refresh(clientId?: string | null) {
  revalidatePath('/assets');
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

/**
 * Records an asset after the browser has uploaded the file straight to Storage.
 *
 * The file never passes through this server: Server Actions are capped at 2mb
 * (next.config.mjs) and agencies upload video, so the upload goes
 * browser → Supabase Storage and only the metadata comes here.
 */
export async function registerAsset(fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);

  const storagePath = str(fd, 'storage_path');
  const name = str(fd, 'name');
  if (!storagePath || !name) throw new Error('The upload did not complete — try again.');

  // The path is built by the browser, so re-check it belongs to this agency
  // before trusting it. Storage RLS enforces the same thing.
  if (!storagePath.startsWith(`${ctx.agencyId}/`)) {
    throw new Error('That file does not belong to this agency.');
  }

  const kind = str(fd, 'kind') as AssetKind | null;
  const clientId = str(fd, 'client_id');
  const sizeRaw = str(fd, 'size_bytes');

  const { data, error } = await ctx.supabase
    .from('assets')
    .insert({
      agency_id: ctx.agencyId,
      client_id: clientId,
      name,
      description: str(fd, 'description'),
      kind: kind && KINDS.includes(kind) ? kind : 'image',
      storage_path: storagePath,
      mime_type: str(fd, 'mime_type'),
      size_bytes: sizeRaw ? Number(sizeRaw) : null,
      tags: csv(fd, 'tags'),
      uploaded_by: ctx.user.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  // Replacing an existing asset: archive it and carry the version forward.
  const replaces = str(fd, 'replaces_id');
  if (replaces) {
    const { error: repErr } = await ctx.supabase.rpc('replace_asset', {
      old_id: replaces,
      new_id: data.id,
    });
    if (repErr) throw new Error(repErr.message);
  } else {
    await logActivity(ctx, 'asset', data.id, 'uploaded', { name });
  }

  refresh(clientId);
}

export async function updateAsset(id: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);
  const name = str(fd, 'name');
  if (!name) throw new Error('Give the asset a name.');
  const kind = str(fd, 'kind') as AssetKind | null;

  const { data, error } = await ctx.supabase
    .from('assets')
    .update({
      name,
      description: str(fd, 'description'),
      kind: kind && KINDS.includes(kind) ? kind : undefined,
      client_id: str(fd, 'client_id'),
      tags: csv(fd, 'tags'),
    })
    .eq('id', id)
    .select('client_id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  refresh(data?.client_id);
}

/** Archiving keeps the file and the history; it just drops out of the library. */
export async function setAssetArchived(id: string, archived: boolean) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);
  const { data, error } = await ctx.supabase
    .from('assets')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id)
    .select('name, client_id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'asset', id, archived ? 'archived' : 'restored', { name: data?.name });
  refresh(data?.client_id);
}

/**
 * Deletes the file and then the row. The file goes first: a row with no file is
 * a broken link in the library, whereas a file with no row is unreadable
 * anyway (the storage read policy requires a matching assets row).
 */
export async function deleteAsset(id: string) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);

  const { data: asset } = await ctx.supabase
    .from('assets')
    .select('name, storage_path, client_id')
    .eq('id', id)
    .maybeSingle();
  if (!asset) throw new Error('Asset not found.');

  const { error: storageError } = await ctx.supabase.storage.from(ASSET_BUCKET).remove([asset.storage_path]);
  if (storageError) throw new Error(`Could not delete the file: ${storageError.message}`);

  const { error } = await ctx.supabase.from('assets').delete().eq('id', id);
  if (error) throw new Error(error.message);

  await logActivity(ctx, 'asset', id, 'deleted', { name: asset.name });
  refresh(asset.client_id);
}

/** Removes an object the browser uploaded when registering it then failed. */
export async function discardOrphanUpload(storagePath: string) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);
  if (!storagePath.startsWith(`${ctx.agencyId}/`)) return;
  await ctx.supabase.storage.from(ASSET_BUCKET).remove([storagePath]);
}

/** A short-lived signed URL for one asset, used by the download redirect. */
export async function signedAssetUrl(id: string, download = false) {
  const ctx = await getContext();
  const { data: asset } = await ctx.supabase
    .from('assets')
    .select('name, storage_path')
    .eq('id', id)
    .maybeSingle();
  if (!asset) return null;

  const { data } = await ctx.supabase.storage
    .from(ASSET_BUCKET)
    .createSignedUrl(asset.storage_path, 300, download ? { download: asset.name } : undefined);
  return data?.signedUrl ?? null;
}

export async function goToAsset(id: string) {
  const url = await signedAssetUrl(id, true);
  if (!url) throw new Error('That asset is no longer available.');
  redirect(url);
}
