import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AuthShell } from '@/components/auth-shell';
import { OnboardingForm } from './onboarding-form';

export const metadata = { title: 'Set up your agency' };

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { count } = await supabase
    .from('memberships')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('active', true);
  if (count && count > 0) redirect('/dashboard');

  return (
    <AuthShell title="Set up your agency" subtitle={`Signed in as ${user.email}.`}>
      <OnboardingForm />
      <div className="mt-8 rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
        <p className="font-medium text-ink">Joining an existing team?</p>
        <p className="mt-1">Open the invite link your admin sent you. It adds you to their agency automatically.</p>
      </div>
      <form action="/auth/signout" method="post" className="mt-4 text-center">
        <button className="text-xs text-zinc-500 hover:text-brand-600">Sign out</button>
      </form>
    </AuthShell>
  );
}
