import { createClient } from '@/lib/supabase/server';
import { AuthShell } from '@/components/auth-shell';
import { LinkButton } from '@/components/ui';
import { ROLES } from '@/lib/constants';
import type { MemberRole } from '@/lib/types';
import { AcceptInvite } from './accept-invite';

export const metadata = { title: 'Join your team' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const [{ data: rows }, { data: auth }] = await Promise.all([
    supabase.rpc('invitation_preview', { invite_token: token }),
    supabase.auth.getUser(),
  ]);
  const invite = (rows as { agency_name: string; email: string; role: MemberRole; expired: boolean; accepted: boolean }[] | null)?.[0];
  const user = auth.user;

  if (!invite) {
    return (
      <AuthShell title="Invitation not found" subtitle="This link is invalid. Ask your admin for a new one.">
        <LinkButton href="/login" variant="secondary">Go to sign in</LinkButton>
      </AuthShell>
    );
  }
  if (invite.accepted || invite.expired) {
    return (
      <AuthShell
        title={invite.accepted ? 'Invitation already used' : 'Invitation expired'}
        subtitle="Ask your admin to send a new invitation."
      >
        <LinkButton href="/dashboard" variant="secondary">Go to Flauntix HQ</LinkButton>
      </AuthShell>
    );
  }

  const roleLabel = ROLES.find((r) => r.value === invite.role)?.label ?? invite.role;
  const next = encodeURIComponent(`/invite/${token}`);

  return (
    <AuthShell title={`Join ${invite.agency_name}`} subtitle={`You've been invited as ${roleLabel} (${invite.email}).`}>
      {user ? (
        user.email?.toLowerCase() === invite.email.toLowerCase() ? (
          <AcceptInvite token={token} />
        ) : (
          <div className="space-y-4 text-sm text-zinc-600">
            <p>
              You're signed in as <strong>{user.email}</strong>, but this invitation is for <strong>{invite.email}</strong>.
            </p>
            <form action="/auth/signout" method="post">
              <button className="font-medium text-brand-600 hover:underline">Sign out and switch account</button>
            </form>
          </div>
        )
      ) : (
        <div className="flex gap-2">
          <LinkButton href={`/signup?next=${next}`}>Create account</LinkButton>
          <LinkButton href={`/login?next=${next}`} variant="secondary">
            I have an account
          </LinkButton>
        </div>
      )}
    </AuthShell>
  );
}
