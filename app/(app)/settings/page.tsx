import { getContext } from '@/lib/auth';
import { changePassword, updateAgency, updateProfile } from '@/lib/actions/team';
import { updateBillingProfile } from '@/lib/actions/invoices';
import { GST_RATES, GST_STATES, SAC_CODES } from '@/lib/gst';
import { ROLES } from '@/lib/constants';
import { SubmitButton } from '@/components/submit-button';
import { Card, CardHeader, Field, Input, PageHeader, Select, Textarea } from '@/components/ui';
import { displayName } from '@/lib/utils';

export const metadata = { title: 'Settings' };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams;
  const ctx = await getContext();
  const role = ROLES.find((r) => r.value === ctx.role);

  // The billing profile is printed on every invoice, so managers can maintain it.
  const { data: billing } = ctx.isManager
    ? await ctx.supabase
        .from('agencies')
        .select('legal_name, gstin, pan, state_code, billing_address, billing_email, billing_phone, bank_details, invoice_prefix, invoice_terms, default_sac, default_gst_rate')
        .eq('id', ctx.agencyId)
        .maybeSingle()
    : { data: null };

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

      {ctx.isManager && (
        <Card className="mt-5">
          <CardHeader
            title="Billing profile"
            subtitle="Printed on every tax invoice. GST will not let you issue one without the state, or charge tax without a GSTIN."
          />
          <form action={updateBillingProfile} className="grid gap-4 px-5 py-4 sm:grid-cols-2">
            <Field label="Registered legal name" hint="As it appears on your GST registration">
              <Input name="legal_name" defaultValue={billing?.legal_name ?? ''} placeholder="Flauntix Digital LLP" />
            </Field>
            <Field label="GSTIN" hint="The check digit is verified on save">
              <Input name="gstin" defaultValue={billing?.gstin ?? ''} maxLength={15} placeholder="27AAPFU0939F1ZV" className="font-mono uppercase" />
            </Field>
            <Field label="State" hint="Your place of business — decides CGST+SGST vs IGST">
              <Select name="state_code" defaultValue={billing?.state_code ?? ''}>
                <option value="">Not set</option>
                {GST_STATES.map((s) => (
                  <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="PAN">
              <Input name="pan" defaultValue={billing?.pan ?? ''} maxLength={10} className="font-mono uppercase" />
            </Field>
            <Field label="Registered address" className="sm:col-span-2">
              <Textarea name="billing_address" rows={2} defaultValue={billing?.billing_address ?? ''} />
            </Field>
            <Field label="Billing email">
              <Input name="billing_email" type="email" defaultValue={billing?.billing_email ?? ''} />
            </Field>
            <Field label="Billing phone">
              <Input name="billing_phone" defaultValue={billing?.billing_phone ?? ''} />
            </Field>
            <Field label="Invoice number prefix" hint="Up to 6 characters. Numbers look like FLX/26-27/001.">
              <Input name="invoice_prefix" defaultValue={billing?.invoice_prefix ?? ''} maxLength={6} placeholder="FLX" className="uppercase" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Default SAC">
                <Select name="default_sac" defaultValue={billing?.default_sac ?? '998361'}>
                  {SAC_CODES.map((c) => (
                    <option key={c.code} value={c.code}>{c.code}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Default GST %">
                <Select name="default_gst_rate" defaultValue={String(billing?.default_gst_rate ?? 18)}>
                  {GST_RATES.map((r) => (
                    <option key={r} value={r}>{r}%</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Bank details" className="sm:col-span-2" hint="Account number, IFSC, UPI — whatever clients pay into">
              <Textarea name="bank_details" rows={2} defaultValue={billing?.bank_details ?? ''} />
            </Field>
            <Field label="Default invoice terms" className="sm:col-span-2">
              <Textarea name="invoice_terms" rows={2} defaultValue={billing?.invoice_terms ?? ''} placeholder="e.g. Payable within 15 days. 18% interest on late payment." />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton>Save billing profile</SubmitButton>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}
