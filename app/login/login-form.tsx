'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { signIn } from '@/lib/actions/auth';
import { FormMessage } from '@/components/auth-shell';
import { Field, Input } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [state, action] = useActionState(signIn, initialError ? { error: initialError } : undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ''} />
      <Field label="Work email">
        <Input name="email" type="email" autoComplete="email" required placeholder="you@flauntix.in" />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingText="Signing in…">
        Sign in
      </SubmitButton>
      <p className="text-center text-xs">
        <Link href="/forgot-password" className="text-zinc-500 hover:text-brand-600">
          Forgot password?
        </Link>
      </p>
    </form>
  );
}
