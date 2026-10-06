import type { ReactNode } from 'react';

export function Logo({ light }: { light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
        F
      </span>
      <span className={light ? 'font-semibold text-white' : 'font-semibold text-ink'}>
        Flauntix <span className={light ? 'text-brand-200' : 'text-brand-500'}>HQ</span>
      </span>
    </span>
  );
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Logo />
          <h1 className="mt-8 text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-zinc-500">{subtitle}</p>}
          {!configured && (
            <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              Supabase is not configured. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
              <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (see README).
            </div>
          )}
          <div className="mt-8">{children}</div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-ink lg:block">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-500/40 blur-3xl" />
        <div className="absolute -bottom-32 left-10 h-96 w-96 rounded-full bg-coral-500/25 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Logo light />
          <div>
            <p className="max-w-md text-3xl font-semibold leading-tight text-white">
              Every client, task and conversation, in one place.
            </p>
            <p className="mt-4 max-w-md text-sm text-zinc-400">
              CRM, projects, time tracking, team chat and a secure credentials vault, built for how Flauntix works.
            </p>
          </div>
          <div className="grid max-w-md grid-cols-3 gap-3 text-xs text-zinc-400">
            {['Clients & CRM', 'Tasks & time', 'Team chat'].map((t) => (
              <div key={t} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FormMessage({ state }: { state?: { error?: string; message?: string } }) {
  if (!state?.error && !state?.message) return null;
  return (
    <p
      role="status"
      className={
        state.error
          ? 'rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700'
          : 'rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800'
      }
    >
      {state.error ?? state.message}
    </p>
  );
}
