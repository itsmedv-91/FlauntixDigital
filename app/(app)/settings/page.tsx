import { getContext } from '@/lib/auth';
import { changePassword, updateAgency, updateProfile } from '@/lib/actions/team';
import { ROLES } from '@/lib/constants';
import { SubmitButton } from '@/components/submit-button';
import { Card, CardHeader, Field, Input, PageHeader } from '@/components/ui';
import { displayName } from '@/lib/utils';

export const metadata = { title: 'Settings' };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams;
  const ctx = await getContext();
  const role = ROLES.find((r) => r.value === ctx.role);

  return (
    <>
      <PageHeader title="Settings" subtitle={`${displayName(ctx.profile)} · ${role?.label} at ${ctx.agency.name}`} />

      {saved === 'password' && (
        <p className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Your password has been updated.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your profile" subtitle="Shown to the rest of the team" />
          <form action={updateProfile} className="space-y-4 px-5 py-4">
            <Field label="Full name">
              <Input name="full_name" required defaultValue={ctx.profile.full_name ?? ''} />
            </Field>
            <Field label="Job title" hint="e.g. Senior Graphic Designer">
              <Input name="job_title" defaultValue={ctx.profile.job_title ?? ''} />
            </Field>
            <Field label="Skills" hint="Comma separated, e.g. reels, copywriting, meta ads">
              <Input name="skills" defaultValue={ctx.profile.skills?.join(', ') ?? ''} />
            </Field>
            <Field label="Email" hint="Sign-in email — contact an admin to change it">
              <Input defaultValue={ctx.profile.email ?? ''} disabled />
            </Field>
            <SubmitButton>Save profile</SubmitButton>
          </form>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Change password" subtitle="At least 8 characters" />
            <form action={changePassword} className="space-y-4 px-5 py-4">
              <Field label="New password">
                <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
              </Field>
              <SubmitButton pendingText="Updating…">Update password</SubmitButton>
            </form>
          </Card>

          <Card>
            <CardHeader
              title="Agency"
              subtitle={ctx.isAdmin ? 'Visible across the platform' : 'Only owners and admins can change this'}
            />
            {ctx.isAdmin ? (
              <form action={updateAgency} className="space-y-4 px-5 py-4">
                <Field label="Agency name">
                  <Input name="name" required defaultValue={ctx.agency.name} />
                </Field>
                <SubmitButton>Save agency</SubmitButton>
              </form>
            ) : (
              <p className="px-5 py-4 text-sm text-zinc-600">{ctx.agency.name}</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
