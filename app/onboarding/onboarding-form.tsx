'use client';

import { useActionState } from 'react';
import { createAgency } from '@/lib/actions/auth';
import { FormMessage } from '@/components/auth-shell';
import { Field, Input } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';

export function OnboardingForm() {
  const [state, action] = useActionState(createAgency, undefined);
  return (
    <form action={action} className="space-y-4">
      <Field label="Agency name">
        <Input name="name" required defaultValue="Flauntix Digital" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingText="Creating…">
        Create agency
      </SubmitButton>
    </form>
  );
}
