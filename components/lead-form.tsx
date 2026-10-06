import { LEAD_SOURCES, LEAD_STAGES, SERVICES } from '@/lib/constants';
import type { Lead, Profile } from '@/lib/types';
import { displayName } from '@/lib/utils';
import { SubmitButton } from './submit-button';
import { Field, Input, Select, Textarea } from './ui';

export function LeadForm({
  action,
  team,
  lead,
  defaultOwnerId,
  submitLabel = 'Add lead',
}: {
  action: (fd: FormData) => Promise<void>;
  team: { user_id: string; profile: Profile | null }[];
  lead?: Lead;
  defaultOwnerId?: string;
  submitLabel?: string;
}) {
  const services = lead?.services_interested ?? [];
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <Field label="Company">
        <Input name="company" required defaultValue={lead?.company} placeholder="e.g. Nivaan Foods" />
      </Field>
      <Field label="Contact person">
        <Input name="contact_name" defaultValue={lead?.contact_name ?? ''} placeholder="Who you spoke to" />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" defaultValue={lead?.email ?? ''} />
      </Field>
      <Field label="Phone">
        <Input name="phone" defaultValue={lead?.phone ?? ''} placeholder="+91…" />
      </Field>
      <Field label="Source">
        <Select name="source" defaultValue={lead?.source ?? ''}>
          <option value="">Not sure</option>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </Field>
      <Field label="Stage">
        <Select name="stage" defaultValue={lead?.stage ?? 'new'}>
          {LEAD_STAGES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Estimated value (₹ / month)">
        <Input name="estimated_value" type="number" min="0" step="1000" defaultValue={lead?.estimated_value ?? ''} />
      </Field>
      <Field label="Owner" hint="Who is chasing this lead">
        <Select name="owner_id" defaultValue={lead?.owner_id ?? defaultOwnerId ?? ''}>
          <option value="">Unassigned</option>
          {team.map((m) => (
            <option key={m.user_id} value={m.user_id}>{displayName(m.profile)}</option>
          ))}
        </Select>
      </Field>
      <Field label="Next follow-up">
        <Input name="next_follow_up" type="date" defaultValue={lead?.next_follow_up ?? ''} />
      </Field>
      <Field label="Lost reason" hint="Only needed if the deal is lost">
        <Input name="lost_reason" defaultValue={lead?.lost_reason ?? ''} placeholder="Budget, timing, went elsewhere…" />
      </Field>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-xs font-medium text-zinc-600">Services they are interested in</legend>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" name="services_interested" value={s} defaultChecked={services.includes(s)} />
              {s}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Notes" className="sm:col-span-2">
        <Textarea name="notes" rows={3} defaultValue={lead?.notes ?? ''} placeholder="What they want, budget signals, next step…" />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
