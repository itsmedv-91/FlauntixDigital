'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { AGENCY_COOKIE, getContext } from '@/lib/auth';
import { str } from '@/lib/utils';

export type FormState = { error?: string; message?: string } | undefined;

async function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}`;
}

function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

export async function signIn(_: FormState, fd: FormData): Promise<FormState> {
  const email = str(fd, 'email');
  const password = str(fd, 'password');
  if (!email || !password) return { error: 'Enter your email and password.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  redirect(safeNext(str(fd, 'next')));
}

export async function signUp(_: FormState, fd: FormData): Promise<FormState> {
  const fullName = str(fd, 'full_name');
  const email = str(fd, 'email');
  const password = str(fd, 'password');
  const next = safeNext(str(fd, 'next'));
  if (!fullName || !email || !password) return { error: 'All fields are required.' };
  if (password.length < 8) return { error: 'Use a password of at least 8 characters.' };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return { error: error.message };

  // If email confirmation is on, there is no session yet.
  if (!data.session) {
    return { message: `Check ${email} for a confirmation link to finish signing up.` };
  }
  redirect(next === '/dashboard' ? '/onboarding' : next);
}

export async function requestPasswordReset(_: FormState, fd: FormData): Promise<FormState> {
  const email = str(fd, 'email');
  if (!email) return { error: 'Enter your email.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteUrl()}/auth/callback?next=/settings`,
  });
  if (error) return { error: error.message };
  return { message: 'If that email has an account, a reset link is on its way.' };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(AGENCY_COOKIE);
  redirect('/login');
}

export async function createAgency(_: FormState, fd: FormData): Promise<FormState> {
  const name = str(fd, 'name');
  if (!name) return { error: 'Give your agency a name.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_agency', { agency_name: name });
  if (error) return { error: error.message };
  (await cookies()).set(AGENCY_COOKIE, data as string, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  redirect('/dashboard');
}

export async function acceptInvite(token: string): Promise<FormState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('accept_invitation', { invite_token: token });
  if (error) return { error: error.message };
  (await cookies()).set(AGENCY_COOKIE, data as string, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  redirect('/dashboard');
}

export async function switchAgency(fd: FormData) {
  const ctx = await getContext();
  const id = str(fd, 'agency_id');
  if (!id || !ctx.memberships.some((m) => m.agency_id === id)) return;
  (await cookies()).set(AGENCY_COOKIE, id, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}
