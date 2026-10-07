'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getPortalContext } from '@/lib/portal';
import { str } from '@/lib/utils';

export type PortalFormState = { error?: string; message?: string } | undefined;

async function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  return `${h.get('x-forwarded-proto') ?? 'https'}://${host}`;
}

/**
 * Sends a magic link. The reply is deliberately the same whether or not the
 * email belongs to a contact, so the portal cannot be used to discover who a
 * given agency works with. Someone unknown who signs in anyway lands on
 * /portal/login?error=no-access, because access comes from client_contacts.
 */
export async function portalSignIn(_: PortalFormState, fd: FormData): Promise<PortalFormState> {
  const email = str(fd, 'email')?.toLowerCase();
  if (!email || !email.includes('@')) return { error: 'Enter the email your agency has on file for you.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: `${await siteUrl()}/portal/auth/callback` },
  });
  if (error) return { error: error.message };
  return { message: `We've emailed a sign-in link to ${email}. It expires in an hour.` };
}

export async function portalDecide(approvalId: string, itemId: string, fd: FormData) {
  const ctx = await getPortalContext();
  const decision = str(fd, 'decision');
  if (decision !== 'approved' && decision !== 'changes_requested') {
    throw new Error('Choose whether to approve or request changes.');
  }
  const comment = str(fd, 'comment');
  if (decision === 'changes_requested' && !comment) {
    throw new Error('Please tell the team what needs changing.');
  }

  const { error } = await ctx.supabase.rpc('portal_decide_approval', {
    approval_id: approvalId,
    new_decision: decision,
    decision_comment: comment,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/portal');
  revalidatePath(`/portal/content/${itemId}`);
}

export async function portalComment(itemId: string, fd: FormData) {
  const ctx = await getPortalContext();
  const body = str(fd, 'body');
  if (!body) throw new Error('Write something first.');

  const { error } = await ctx.supabase.rpc('portal_add_comment', { item_id: itemId, body });
  if (error) throw new Error(error.message);
  revalidatePath(`/portal/content/${itemId}`);
}
