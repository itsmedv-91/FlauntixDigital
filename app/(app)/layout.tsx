import { getContext } from '@/lib/auth';
import { switchAgency } from '@/lib/actions/auth';
import { ROLES } from '@/lib/constants';
import { displayName } from '@/lib/utils';
import { Sidebar, type NavItem } from '@/components/sidebar';
import { TimerPill } from '@/components/timer-pill';
import { Avatar } from '@/components/ui';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();

  const { data: running } = await ctx.supabase
    .from('time_entries')
    .select('id, started_at, note, task:tasks(title)')
    .eq('user_id', ctx.user.id)
    .is('ended_at', null)
    .maybeSingle();

  const items: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: 'home' },
    { href: '/tasks', label: 'Tasks', icon: 'tasks' },
    // Freelancers see only the content assigned to them (enforced by RLS).
    { href: '/content', label: 'Content', icon: 'content' },
    // Freelancers see agency-wide assets plus the clients they have work on (RLS).
    { href: '/assets', label: 'Assets', icon: 'assets' },
    ...(ctx.isStaff
      ? ([
          { href: '/projects', label: 'Projects', icon: 'projects' },
          { href: '/clients', label: 'Clients', icon: 'clients' },
          { href: '/leads', label: 'Leads & CRM', icon: 'leads' },
        ] as NavItem[])
      : []),
    // Billing is managers and above, the same as the invoices RLS policy.
    ...(ctx.isManager
      ? ([
          { href: '/invoices', label: 'Invoices', icon: 'invoices' },
          { href: '/profitability', label: 'Profitability', icon: 'margin' },
        ] as NavItem[])
      : []),
    { href: '/time', label: 'Time', icon: 'time' },
    { href: '/chat', label: 'Chat', icon: 'chat' },
    ...(ctx.isStaff ? ([{ href: '/team', label: 'Team', icon: 'team' }] as NavItem[]) : []),
    { href: '/settings', label: 'Settings', icon: 'settings' },
  ];

  const roleLabel = ROLES.find((r) => r.value === ctx.role)?.label;
  const runningTask = running?.task as unknown as { title: string } | null;

  const footer = (
    <div className="space-y-3 px-1">
      {ctx.memberships.length > 1 && (
        <form action={switchAgency}>
          <select
            name="agency_id"
            defaultValue={ctx.agencyId}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-zinc-200"
          >
            {ctx.memberships.map((m) => (
              <option key={m.agency_id} value={m.agency_id} className="text-ink">
                {m.agency.name}
              </option>
            ))}
          </select>
          <button className="mt-1 text-[11px] text-zinc-400 hover:text-white">Switch agency</button>
        </form>
      )}
      <div className="flex items-center gap-2.5">
        <Avatar person={ctx.profile} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{displayName(ctx.profile)}</p>
          <p className="truncate text-[11px] text-zinc-400">
            {roleLabel} · {ctx.agency.name}
          </p>
        </div>
      </div>
      <form action="/auth/signout" method="post">
        <button className="text-xs text-zinc-400 hover:text-white">Sign out</button>
      </form>
    </div>
  );

  return (
    <div className="min-h-screen">
      <Sidebar items={items} footer={footer} />
      <div className="lg:pl-60 print:pl-0">
        {running && (
          <div className="no-print sticky top-0 z-10 flex justify-end border-b border-zinc-200/70 bg-[#f6f5f9]/90 px-4 py-2 backdrop-blur sm:px-8">
            <TimerPill startedAt={running.started_at} label={runningTask?.title ?? running.note ?? 'Timer running'} />
          </div>
        )}
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-8 sm:py-8 print:max-w-none print:p-0">{children}</main>
      </div>
    </div>
  );
}
