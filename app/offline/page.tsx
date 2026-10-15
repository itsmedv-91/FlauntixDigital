import { Logo } from '@/components/auth-shell';

export const metadata = { title: 'Offline' };

/**
 * The only page the service worker ever serves from its cache, and only when a
 * navigation actually fails. It carries no data on purpose: a cached page
 * showing yesterday's client list would be worse than this.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink px-6 text-center">
      <Logo light />
      <h1 className="mt-8 text-xl font-semibold text-white">You are offline</h1>
      <p className="mt-2 max-w-sm text-sm text-zinc-400">
        Flauntix HQ needs a connection — everything here is live agency data, so there is nothing safe to show from a
        cache. This page will work again as soon as you are back online.
      </p>
      <a
        href="/dashboard"
        className="mt-6 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
      >
        Try again
      </a>
    </div>
  );
}
