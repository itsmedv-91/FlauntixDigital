'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertRole, getContext, logActivity } from '@/lib/auth';
import { ADMIN_ROLES, MANAGER_ROLES } from '@/lib/constants';
import { list, num, str } from '@/lib/utils';

function clientFields(fd: FormData) {
  return {
    name: str(fd, 'name'),
    industry: str(fd, 'industry'),
    website: str(fd, 'website'),
    status: str(fd, 'status') ?? 'onboarding',
    account_manager_id: str(fd, 'account_manager_id'),
    services: list(fd, 'services'),
    monthly_retainer: num(fd, 'monthly_retainer'),
    contract_start: str(fd, 'contract_start'),
    contract_end: str(fd, 'contract_end'),
    brand_colors: str(fd, 'brand_colors'),
    brand_voice: str(fd, 'brand_voice'),
    notes: str(fd, 'notes'),
  };
}

export async function createClientRecord(fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const fields = clientFields(fd);
  if (!fields.name) throw new Error('Client name is required.');

  const { data, error } = await ctx.supabase
    .from('clients')
    .insert({ ...fields, agency_id: ctx.agencyId })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  // Every client gets its own chat channel.
  await ctx.supabase.from('channels').insert({
    agency_id: ctx.agencyId,
    name: fields.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    kind: 'client',
    client_id: data.id,
    created_by: ctx.user.id,
  });

  await logActivity(ctx, 'client', data.id, 'created', { name: fields.name });
  revalidatePath('/clients');
  redirect(`/clients/${data.id}`);
}

export async function updateClientRecord(id: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const fields = clientFields(fd);
  if (!fields.name) throw new Error('Client name is required.');
  const { error } = await ctx.supabase.from('clients').update(fields).eq('id', id);
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'client', id, 'updated', { name: fields.name });
  revalidatePath(`/clients/${id}`);
  redirect(`/clients/${id}`);
}

export async function deleteClientRecord(id: string) {
  const ctx = await getContext();
  assertRole(ctx, ADMIN_ROLES);
  const { error } = await ctx.supabase.from('clients').delete().eq('id', id);
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'client', id, 'deleted');
  revalidatePath('/clients');
  redirect('/clients');
}

export async function addContact(clientId: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const name = str(fd, 'name');
  if (!name) throw new Error('Contact name is required.');
  const isPrimary = fd.get('is_primary') === 'on';
  if (isPrimary) {
    await ctx.supabase.from('client_contacts').update({ is_primary: false }).eq('client_id', clientId);
  }
  const { error } = await ctx.supabase.from('client_contacts').insert({
    agency_id: ctx.agencyId,
    client_id: clientId,
    name,
    email: str(fd, 'email'),
    phone: str(fd, 'phone'),
    designation: str(fd, 'designation'),
    is_primary: isPrimary,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/clients/${clientId}`);
}

/**
 * Grants or revokes a contact's access to the client portal. Access is keyed on
 * their email, so there has to be one, and it has to be right — whoever can read
 * that inbox can sign in and see this client's shared content.
 */
export async function setPortalAccess(clientId: string, contactId: string, enabled: boolean) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);

  const { data: contact } = await ctx.supabase
    .from('client_contacts')
    .select('name, email')
    .eq('id', contactId)
    .maybeSingle();
  if (!contact) throw new Error('Contact not found.');
  if (enabled && !contact.email) throw new Error('Add an email address for this contact first.');

  const { error } = await ctx.supabase
    .from('client_contacts')
    .update({ portal_enabled: enabled })
    .eq('id', contactId);
  if (error) throw new Error(error.message);

  await logActivity(ctx, 'client', clientId, enabled ? 'portal_granted' : 'portal_revoked', {
    name: contact.name,
    email: contact.email,
  });
  revalidatePath(`/clients/${clientId}`);
}

export async function deleteContact(clientId: string, contactId: string) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  await ctx.supabase.from('client_contacts').delete().eq('id', contactId);
  revalidatePath(`/clients/${clientId}`);
}
