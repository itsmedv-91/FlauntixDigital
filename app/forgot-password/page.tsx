import Link from 'next/link';
import { AuthShell } from '@/components/auth-shell';
import { ForgotForm } from './forgot-form';

export const metadata = { title: 'Reset password' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a link to set a new one.">
      <ForgotForm />
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="text-zinc-500 hover:text-brand-600">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
