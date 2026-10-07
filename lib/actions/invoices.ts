'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertRole, getContext, logActivity } from '@/lib/auth';
import { MANAGER_ROLES } from '@/lib/constants';
import { gstinProblem, stateName } from '@/lib/gst';
import { num, str } from '@/lib/utils';

function refresh(id?: string, clientId?: string | null) {
  revalidatePath('/invoices');
  if (id) {
    revalidatePath(`/invoices/${id}`);
    revalidatePath(`/invoices/${id}/print`);
  }
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

/**
 * Opens a draft. The supplier state and place of supply are copied in now so
 * the tax split is right while the draft is still being edited; `issue_invoice`
 * re-snapshots everything at the moment of issue.
 */
export async function createInvoice(fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);

  const clientId = str(fd, 'client_id');
  if (!clientId) throw new Error('Choose the client to bill.');

  const [{ data: client }, { data: agency }] = await Promise.all([
    ctx.supabase.from('clients').select('state_code').eq('id', clientId).maybeSingle(),
    ctx.supabase.from('agencies').select('state_code, invoice_terms, bank_details').eq('id', ctx.agencyId).maybeSingle(),
  ]);

  const placeOfSupply = str(fd, 'place_of_supply_code') ?? client?.state_code ?? null;
  const { data, error } = await ctx.supabase
    .from('invoices')
    .insert({
      agency_id: ctx.agencyId,
      client_id: clientId,
      issue_date: str(fd, 'issue_date'),
      due_date: str(fd, 'due_date'),
      supplier_state_code: agency?.state_code ?? null,
      place_of_supply_code: placeOfSupply,
      place_of_supply_name: stateName(placeOfSupply),
      reverse_charge: fd.get('reverse_charge') === 'on',
      notes: str(fd, 'notes'),
      terms: str(fd, 'terms') ?? agency?.invoice_terms ?? null,
      bank_details: agency?.bank_details ?? null,
      created_by: ctx.user.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  await logActivity(ctx, 'invoice', data.id, 'draft_created', { client_id: clientId });
  refresh(data.id, clientId);
  redirect(`/invoices/${data.id}`);
}

/** Edits a draft's header. RLS refuses this once the invoice is issued. */
export async function updateInvoice(id: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);

  const placeOfSupply = str(fd, 'place_of_supply_code');
  const { error } = await ctx.supabase
    .from('invoices')
    .update({
      issue_date: str(fd, 'issue_date'),
      due_date: str(fd, 'due_date'),
      place_of_supply_code: placeOfSupply,
      place_of_supply_name: stateName(placeOfSupply),
      reverse_charge: fd.get('reverse_charge') === 'on',
      notes: str(fd, 'notes'),
      terms: str(fd, 'terms'),
      bank_details: str(fd, 'bank_details'),
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
  refresh(id);
}

export async function addInvoiceLine(invoiceId: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);

  const description = str(fd, 'description');
  if (!description) throw new Error('Describe what you are billing for.');
  const unitPrice = num(fd, 'unit_price');
  if (unitPrice === null || unitPrice < 0) throw new Error('Enter an amount.');

  const { data: last } = await ctx.supabase
    .from('invoice_lines')
    .select('position')
    .eq('invoice_id', invoiceId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await ctx.supabase.from('invoice_lines').insert({
    agency_id: ctx.agencyId,
    invoice_id: invoiceId,
    project_id: str(fd, 'project_id'),
    description,
    sac_code: str(fd, 'sac_code'),
    quantity: num(fd, 'quantity') ?? 1,
    unit_price: unitPrice,
    discount_pct: num(fd, 'discount_pct') ?? 0,
    gst_rate: num(fd, 'gst_rate') ?? 18,
    position: (last?.position ?? 0) + 1,
  });
  if (error) throw new Error(error.message);
  refresh(invoiceId);
}

export async function deleteInvoiceLine(invoiceId: string, lineId: string) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const { error } = await ctx.supabase.from('invoice_lines').delete().eq('id', lineId);
  if (error) throw new Error(error.message);
  refresh(invoiceId);
}

/**
 * Issues the invoice. The RPC validates it, snapshots both parties and
 * allocates the next number for the financial year in one transaction.
 */
export async function issueInvoice(id: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const { data, error } = await ctx.supabase.rpc('issue_invoice', {
    inv_id: id,
    issue_on: str(fd, 'issue_date'),
  });
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'invoice', id, 'issued', { number: data });
  refresh(id);
}

export async function cancelInvoice(id: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const reason = str(fd, 'cancel_reason');
  if (!reason) throw new Error('Note why this invoice is being cancelled.');
  const { error } = await ctx.supabase.rpc('cancel_invoice', { inv_id: id, reason });
  if (error) throw new Error(error.message);
  refresh(id);
}

/** Only a draft can be deleted — an issued invoice is cancelled instead. */
export async function deleteInvoice(id: string) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const { data } = await ctx.supabase.from('invoices').select('status, client_id').eq('id', id).maybeSingle();
  if (data?.status !== 'draft') {
    throw new Error('An issued invoice cannot be deleted — cancel it instead, so the numbering stays intact.');
  }
  const { error } = await ctx.supabase.from('invoices').delete().eq('id', id);
  if (error) throw new Error(error.message);
  refresh(undefined, data?.client_id);
  redirect('/invoices');
}

export async function addPayment(invoiceId: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const amount = num(fd, 'amount');
  if (amount === null || amount <= 0) throw new Error('Enter the amount received.');

  const { error } = await ctx.supabase.from('invoice_payments').insert({
    agency_id: ctx.agencyId,
    invoice_id: invoiceId,
    amount,
    paid_on: str(fd, 'paid_on') ?? undefined,
    method: str(fd, 'method'),
    reference: str(fd, 'reference'),
    note: str(fd, 'note'),
    created_by: ctx.user.id,
  });
  if (error) throw new Error(error.message);
  await logActivity(ctx, 'invoice', invoiceId, 'payment_recorded', { amount });
  refresh(invoiceId);
}

export async function deletePayment(invoiceId: string, paymentId: string) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);
  const { error } = await ctx.supabase.from('invoice_payments').delete().eq('id', paymentId);
  if (error) throw new Error(error.message);
  refresh(invoiceId);
}

/** Saves the agency's own billing identity, which every invoice is printed from. */
export async function updateBillingProfile(fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, MANAGER_ROLES);

  const gstin = str(fd, 'gstin')?.toUpperCase() ?? null;
  const problem = gstinProblem(gstin);
  if (problem) throw new Error(`Your GSTIN: ${problem}`);

  const prefix = str(fd, 'invoice_prefix')?.toUpperCase() ?? null;
  if (prefix && !/^[A-Z0-9-]{1,6}$/.test(prefix)) {
    throw new Error('Use at most 6 letters or digits for the invoice prefix (it has to fit in a 16-character number).');
  }

  const { error } = await ctx.supabase
    .from('agencies')
    .update({
      legal_name: str(fd, 'legal_name'),
      gstin,
      pan: str(fd, 'pan')?.toUpperCase() ?? null,
      state_code: str(fd, 'state_code'),
      billing_address: str(fd, 'billing_address'),
      billing_email: str(fd, 'billing_email'),
      billing_phone: str(fd, 'billing_phone'),
      bank_details: str(fd, 'bank_details'),
      invoice_prefix: prefix,
      invoice_terms: str(fd, 'invoice_terms'),
      default_sac: str(fd, 'default_sac'),
      default_gst_rate: num(fd, 'default_gst_rate'),
    })
    .eq('id', ctx.agencyId);
  if (error) throw new Error(error.message);
  revalidatePath('/settings');
  revalidatePath('/invoices');
}
