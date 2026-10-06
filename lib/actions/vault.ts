'use server';

import { revalidatePath } from 'next/cache';
import { assertRole, getContext, logActivity } from '@/lib/auth';
import { MANAGER_ROLES } from '@/lib/constants';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { str } from '@/lib/utils';

export async function addCredential(clientId: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const platform = str(fd, 'platform');
  const secret = fd.get('secret');
  if (!platform) throw new Error('Choose a platform.');
  if (typeof secret !== 'string' || secret.length === 0) throw new Error('Enter the password or secret.');

  const { data, error } = await ctx.supabase
    .from('credentials')
    .insert({
      agency_id: ctx.agencyId,
      client_id: clientId,
      platform,
      label: str(fd, 'label'),
      username: str(fd, 'username'),
      url: str(fd, 'url'),
      notes: str(fd, 'notes'),
      secret_ciphertext: encryptSecret(secret),
      created_by: ctx.user.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'credential', data.id, 'created', { platform, client_id: clientId });
  revalidatePath(`/clients/${clientId}`);
}

/** Returns the decrypted secret. Every reveal is written to the activity log. */
export async function revealCredential(id: string): Promise<{ secret?: string; error?: string }> {
  const ctx = await getContext();
  if (!ctx.isManager) return { error: 'Only managers can view vault secrets.' };
  const { data, error } = await ctx.supabase
    .from('credentials')
    .select('id, platform, client_id, secret_ciphertext')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return { error: 'Credential not found.' };
  try {
    const secret = decryptSecret(data.secret_ciphertext);
    await logActivity(ctx, 'credential', id, 'revealed', { platform: data.platform, client_id: data.client_id });
    return { secret };
  } catch {
    return { error: 'Could not decrypt. Check CREDENTIALS_ENCRYPTION_KEY.' };
  }
}

export async function updateCredentialSecret(clientId: string, id: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const secret = fd.get('secret');
  if (typeof secret !== 'string' || !secret) throw new Error('Enter the new secret.');
  const { error } = await ctx.supabase
    .from('credentials')
    .update({ secret_ciphertext: encryptSecret(secret) })
    .eq('id', id);
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'credential', id, 'rotated');
  revalidatePath(`/clients/${clientId}`);
}

export async function deleteCredential(clientId: string, id: string) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  await ctx.supabase.from('credentials').delete().eq('id', id);
  await logActivity(ctx, 'credential', id, 'deleted');
  revalidatePath(`/clients/${clientId}`);
}
