'use client';

import { useFormStatus } from 'react-dom';
import type { ComponentProps } from 'react';
import { Button } from './ui';

export function SubmitButton({
  children,
  pendingText,
  confirm,
  ...props
}: ComponentProps<typeof Button> & { pendingText?: string; confirm?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending || props.disabled}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      {...props}
    >
      {pending ? pendingText ?? 'Saving…' : children}
    </Button>
  );
}
