import { CLIENT_STATUSES, SERVICES } from '@/lib/constants';
import { GST_STATES } from '@/lib/gst';
import type { Client, Profile } from '@/lib/types';
import { displayName } from '@/lib/utils';
import { SubmitButton } from './submit-button';
import { Field, Input, Select, Textarea } from './ui';

export function ClientForm({
  action,
  team,
  client,
  submitLabel = 'Create client',
}: {
  action: (fd: FormData) => Promise<void>;
  team: { user_id: string; profile: Profile | null }[];
  client?: Client;
  submitLabel?: string;
}) {
  const services = new Set(client?.services ?? []);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <Field label="Client / brand name" className="sm:col-span-2">
        <Input name="name" required defaultValue={client?.name} />
      </Field>
      <Field label="Industry">
        <Input name="industry" defaultValue={client?.industry ?? ''} placeholder="e.g. F&B, Real estate, D2C fashion" />
      </Field>
      <Field label="Website">
        <Input name="website" type="url" defaultValue={client?.website ?? ''} placeholder="https://" />
      </Field>
      <Field label="Status">
        <Select name="status" defaultValue={client?.status ?? 'onboarding'}>
          {CLIENT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
      </Field>
      <Field label="Account manager">
        <Select name="account_manager_id" defaultValue={client?.account_manager_id ?? ''}>
          <option value="">Not assigned</option>
          {team.map((m) => <option key={m.user_id} value={m.user_id}>{displayName(m.profile)}</option>)}
        </Select>
      </Field>
      <Field label="Monthly retainer (₹)">
        <Input name="monthly_retainer" type="number" min="0" step="500" defaultValue={client?.monthly_retainer ?? ''} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contract start">
          <Input name="contract_start" type="date" defaultValue={client?.contract_start ?? ''} />
        </Field>
        <Field label="Contract end">
          <Input name="contract_end" type="date" defaultValue={client?.contract_end ?? ''} />
        </Field>
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="mb-2 text-xs font-medium text-zinc-600">Services</legend>
        <div className="flex flex-wrap gap-2">
          {SERVICES.map((s) => (
            <label key={s} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs has-[:checked]:border-brand-300 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-800">
              <input type="checkbox" name="services" value={s} defaultChecked={services.has(s)} className="accent-brand-500" />
              {s}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Brand colours" hint="Hex codes, e.g. #6D4AFF, #15131F">
        <Input name="brand_colors" defaultValue={client?.brand_colors ?? ''} />
      </Field>
      <Field label="Tone of voice">
        <Input name="brand_voice" defaultValue={client?.brand_voice ?? ''} placeholder="e.g. Warm, witty, Hinglish-friendly" />
      </Field>
      <Field label="Notes" className="sm:col-span-2">
        <Textarea name="notes" defaultValue={client?.notes ?? ''} placeholder="Goals, competitors, do's and don'ts, approval process…" />
      </Field>
      <fieldset className="grid gap-4 border-t border-zinc-100 pt-4 sm:col-span-2 sm:grid-cols-2">
        <legend className="-mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 sm:col-span-2">
          Billing — needed to raise a GST invoice
        </legend>
        <Field label="GSTIN" hint="15 characters; the check digit is verified on save">
          <Input name="gstin" defaultValue={client?.gstin ?? ''} placeholder="27AACCM1234A1Z5" maxLength={15} className="font-mono uppercase" />
        </Field>
        <Field label="State (place of supply)" hint="Decides CGST+SGST vs IGST">
          <Select name="state_code" defaultValue={client?.state_code ?? ''}>
            <option value="">Not set</option>
            {GST_STATES.map((s) => (
              <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Billing address" className="sm:col-span-2">
          <Textarea name="billing_address" rows={2} defaultValue={client?.billing_address ?? ''} placeholder="As it should appear on the invoice" />
        </Field>
        <Field label="Billing email" hint="Where invoices get sent">
          <Input name="billing_email" type="email" defaultValue={client?.billing_email ?? ''} />
        </Field>
      </fieldset>

      <div className="sm:col-span-2">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
