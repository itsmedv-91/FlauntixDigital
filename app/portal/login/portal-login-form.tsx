'use client';

import { useActionState } from 'react';
import { portalSignIn } from '@/lib/actions/portal';
import { FormMessage } from '@/components/auth-shell';
import { Field, Input } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';

export function PortalLoginForm({ initialError }: { initialError?: string }) {
  const [state, action] = useActionState(portalSignIn, initialError ? { error: initialError } : undefined);
  return (
    <form action={action} className="space-y-4">
      <Field label="Your email" hint="The address your agency has on file for you">
        <Input name="email" type="email" autoComplete="email" required placeholder="you@yourcompany.in" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingText="Sending…">
        Email me a sign-in link
      </SubmitButton>
      <p className="text-center text-xs text-zinc-500">
        No password needed. We&apos;ll email you a link that signs you straight in.
      </p>
    </form>
  );
}
