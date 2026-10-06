'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertRole, getContext, logActivity } from '@/lib/auth';
import { MANAGER_ROLES } from '@/lib/constants';
import type { LeadStage } from '@/lib/types';
import { list, num, str } from '@/lib/utils';

const STAGES: LeadStage[] = ['new', 'contacted', 'discovery', 'proposal', 'negotiation', 'won', 'lost'];

function leadFields(fd: FormData) {
  const stage = str(fd, 'stage') as LeadStage | null;
  return {
    company: str(fd, 'company'),
    contact_name: str(fd, 'contact_name'),
    email: str(fd, 'email'),
    phone: str(fd, 'phone'),
    source: str(fd, 'source'),
    services_interested: list(fd, 'services_interested'),
    estimated_value: num(fd, 'estimated_value'),
    stage: stage && STAGES.includes(stage) ? stage : 'new',
    owner_id: str(fd, 'owner_id'),
    next_follow_up: str(fd, 'next_follow_up'),
    lost_reason: str(fd, 'lost_reason'),
    notes: str(fd, 'notes'),
  };
}

export async function createLead(fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const fields = leadFields(fd);
  if (!fields.company) throw new Error('Company name is required.');
  const { data, error } = await ctx.supabase
    .from('leads')
    .insert({ ...fields, owner_id: fields.owner_id ?? ctx.user.id, agency_id: ctx.agencyId })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'lead', data.id, 'created', { company: fields.company });
  revalidatePath('/leads');
}

export async function updateLead(id: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const fields = leadFields(fd);
  if (!fields.company) throw new Error('Company name is required.');
  const { error } = await ctx.supabase.from('leads').update(fields).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/leads');
  redirect('/leads');
}

export async function moveLead(id: string, stage: LeadStage) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  if (!STAGES.includes(stage)) throw new Error('Unknown stage.');
  const { error } = await ctx.supabase.from('leads').update({ stage }).eq('id', id);
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'lead', id, 'moved', { stage });
  revalidatePath('/leads');
}

/** Turns a won lead into a client, copying over the contact and services. */
export async function convertLead(id: string) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const { data: lead, error } = await ctx.supabase.from('leads').select('*').eq('id', id).single();
  if (error || !lead) throw new Error('Lead not found.');
  if (lead.converted_client_id) redirect(`/clients/${lead.converted_client_id}`);

  const { data: client, error: cErr } = await ctx.supabase
    .from('clients')
    .insert({
      agency_id: ctx.agencyId,
      name: lead.company,
      status: 'onboarding',
      services: lead.services_interested ?? [],
      monthly_retainer: lead.estimated_value,
      account_manager_id: lead.owner_id,
      notes: lead.notes,
    })
    .select('id')
    .single();
  if (cErr) throw new Error(cErr.message);

  if (lead.contact_name) {
    await ctx.supabase.from('client_contacts').insert({
      agency_id: ctx.agencyId,
      client_id: client.id,
      name: lead.contact_name,
      email: lead.email,
      phone: lead.phone,
      is_primary: true,
    });
  }
  await ctx.supabase.from('channels').insert({
    agency_id: ctx.agencyId,
    name: String(lead.company).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    kind: 'client',
    client_id: client.id,
    created_by: ctx.user.id,
  });
  await ctx.supabase.from('leads').update({ stage: 'won', converted_client_id: client.id }).eq('id', id);
  await logActivity(ctx, 'lead', id, 'converted', { client_id: client.id, company: lead.company });
  revalidatePath('/leads');
  revalidatePath('/clients');
  redirect(`/clients/${client.id}`);
}

export async function deleteLead(id: string) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  await ctx.supabase.from('leads').delete().eq('id', id);
  revalidatePath('/leads');
  redirect('/leads');
}
