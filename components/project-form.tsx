import { PROJECT_STATUSES } from '@/lib/constants';
import type { Profile, Project } from '@/lib/types';
import { displayName } from '@/lib/utils';
import { SubmitButton } from './submit-button';
import { Field, Input, Select, Textarea } from './ui';

export function ProjectForm({
  action,
  clients,
  team,
  project,
  defaultClientId,
  submitLabel = 'Create project',
}: {
  action: (fd: FormData) => Promise<void>;
  clients: { id: string; name: string }[];
  team: { user_id: string; profile: Profile | null }[];
  project?: Project;
  defaultClientId?: string;
  submitLabel?: string;
}) {
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <Field label="Project name" className="sm:col-span-2">
        <Input name="name" required defaultValue={project?.name} placeholder="e.g. October social media retainer" />
      </Field>
      <Field label="Client">
        <Select name="client_id" defaultValue={project?.client_id ?? defaultClientId ?? ''}>
          <option value="">Internal (no client)</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Project lead">
        <Select name="owner_id" defaultValue={project?.owner_id ?? ''}>
          <option value="">Me</option>
          {team.map((m) => <option key={m.user_id} value={m.user_id}>{displayName(m.profile)}</option>)}
        </Select>
      </Field>
      <Field label="Status">
        <Select name="status" defaultValue={project?.status ?? 'active'}>
          {PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
      </Field>
      <Field label="Budget (₹)">
        <Input name="budget" type="number" min="0" step="100" defaultValue={project?.budget ?? ''} />
      </Field>
      <Field label="Start date">
        <Input name="start_date" type="date" defaultValue={project?.start_date ?? ''} />
      </Field>
      <Field label="Due date">
        <Input name="due_date" type="date" defaultValue={project?.due_date ?? ''} />
      </Field>
      <Field label="Description" className="sm:col-span-2">
        <Textarea name="description" defaultValue={project?.description ?? ''} placeholder="Goals, deliverables and scope" />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
