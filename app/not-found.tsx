import { LinkButton } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <p className="text-sm font-semibold text-brand-500">404</p>
      <h1 className="mt-2 text-xl font-semibold text-ink">This page doesn&apos;t exist, or you don&apos;t have access to it.</h1>
      <div className="mt-6">
        <LinkButton href="/dashboard">Back to dashboard</LinkButton>
      </div>
    </div>
  );
}
