'use client';

import { useActionState } from 'react';
import { requestPasswordReset } from '@/lib/actions/auth';
import { FormMessage } from '@/components/auth-shell';
import { Field, Input } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';

export function ForgotForm() {
  const [state, action] = useActionState(requestPasswordReset, undefined);
  return (
    <form action={action} className="space-y-4">
      <Field label="Work email">
        <Input name="email" type="email" required autoComplete="email" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingText="Sending…">
        Send reset link
      </SubmitButton>
    </form>
  );
}
