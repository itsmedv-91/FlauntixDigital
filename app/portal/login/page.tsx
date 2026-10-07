import { PortalLoginForm } from './portal-login-form';
import { Logo } from '@/components/auth-shell';

export const metadata = { title: 'Client sign in' };

export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="flex min-h-screen flex-col justify-center bg-[#f6f5f9] px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <Logo />
        <h1 className="mt-8 text-2xl font-semibold tracking-tight text-ink">Review your content</h1>
        <p className="mt-1.5 text-sm text-zinc-500">
          Approve what your agency has lined up for you, or ask for changes.
        </p>
        <div className="mt-8 rounded-xl border border-zinc-200/80 bg-white p-5 shadow-card">
          <PortalLoginForm initialError={error} />
        </div>
        <p className="mt-6 text-center text-xs text-zinc-400">
          Work at the agency instead?{' '}
          <a href="/login" className="font-medium text-brand-600 hover:underline">
            Team sign in
          </a>
        </p>
      </div>
    </div>
  );
}
