import { getPortalContext } from '@/lib/portal';
import { Logo } from '@/components/auth-shell';

/**
 * This layout lives in a (portal) route group on purpose: it guards every page
 * under it, and getPortalContext() redirects a signed-out visitor to
 * /portal/login. If this file sat at app/portal/layout.tsx it would wrap the
 * login page too, and /portal/login would redirect to itself forever.
 */

export const metadata = { title: 'Client portal' };

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPortalContext();
  const clients = [...new Set(ctx.contacts.map((c) => c.client_name))];

  return (
    <div className="min-h-screen bg-[#f6f5f9]">
      <header className="border-b border-zinc-200/80 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="hidden text-sm text-zinc-400 sm:inline">·</span>
            <span className="hidden text-sm text-zinc-600 sm:inline">{clients.join(', ')}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-zinc-500">{ctx.contact.name}</span>
            <form action="/auth/signout" method="post">
              <input type="hidden" name="next" value="/portal/login" />
              <button className="text-xs font-medium text-zinc-500 hover:text-brand-600">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      <footer className="mx-auto max-w-5xl px-4 pb-10 text-center text-xs text-zinc-400 sm:px-6">
        Shared with you by {ctx.agencyName}.
      </footer>
    </div>
  );
}
