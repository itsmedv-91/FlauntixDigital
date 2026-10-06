'use client';

import { Button } from '@/components/ui';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <p className="text-sm font-semibold text-coral-500">Something went wrong</p>
      <h1 className="mt-2 text-xl font-semibold text-ink">{error.message || 'Unexpected error'}</h1>
      <p className="mt-2 text-sm text-zinc-500">Nothing was lost. Try again, or go back to the previous page.</p>
      <div className="mt-6 flex justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="secondary" onClick={() => history.back()}>
          Go back
        </Button>
      </div>
    </div>
  );
}
