'use client';

import { useActionState } from 'react';
import { signUp } from '@/lib/actions/auth';
import { FormMessage } from '@/components/auth-shell';
import { Field, Input } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';

export function SignupForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signUp, undefined);
  if (state?.message) return <FormMessage state={state} />;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ''} />
      <Field label="Full name">
        <Input name="full_name" required autoComplete="name" />
      </Field>
      <Field label="Work email">
        <Input name="email" type="email" required autoComplete="email" />
      </Field>
      <Field label="Password" hint="At least 8 characters.">
        <Input name="password" type="password" minLength={8} required autoComplete="new-password" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingText="Creating account…">
        Create account
      </SubmitButton>
    </form>
  );
}
