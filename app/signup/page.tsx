import Link from 'next/link';
import { AuthShell } from '@/components/auth-shell';
import { SignupForm } from './signup-form';

export const metadata = { title: 'Create account' };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthShell
      title="Create your account"
      subtitle={next?.startsWith('/invite/') ? 'Use the email address your invitation was sent to.' : 'Set up Flauntix HQ for your agency.'}
    >
      <SignupForm next={next} />
      <p className="mt-6 text-center text-sm text-zinc-500">
        Already have an account?{' '}
        <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
