'use client';

import { useActionState } from 'react';
import { acceptInvite } from '@/lib/actions/auth';
import { FormMessage } from '@/components/auth-shell';
import { SubmitButton } from '@/components/submit-button';

export function AcceptInvite({ token }: { token: string }) {
  const [state, action] = useActionState(() => acceptInvite(token), undefined);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingText="Joining…">
        Accept invitation
      </SubmitButton>
    </form>
  );
}
