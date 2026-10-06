import Link from 'next/link';
import { AuthShell } from '@/components/auth-shell';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to Flauntix HQ.">
      <LoginForm next={next} initialError={error} />
      <p className="mt-6 text-center text-sm text-zinc-500">
        New here?{' '}
        <Link href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-brand-600 hover:underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
