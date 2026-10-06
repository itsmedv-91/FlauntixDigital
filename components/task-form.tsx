import { TASK_PRIORITIES, TASK_STATUSES } from '@/lib/constants';
import type { Profile, Task } from '@/lib/types';
import { displayName } from '@/lib/utils';
import { SubmitButton } from './submit-button';
import { Field, Input, Select, Textarea } from './ui';

export function TaskForm({
  action,
  projects,
  team,
  task,
  defaults,
  submitLabel = 'Create task',
  redirectTo,
}: {
  action: (fd: FormData) => Promise<void>;
  projects: { id: string; name: string; client?: { name: string } | null }[];
  team: { user_id: string; profile: Profile | null }[];
  task?: Task;
  defaults?: { project_id?: string; assignee_id?: string; status?: string };
  submitLabel?: string;
  redirectTo?: string;
}) {
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      {redirectTo && <input type="hidden" name="redirect_to" value={redirectTo} />}
      <Field label="Title" className="sm:col-span-2">
        <Input name="title" required defaultValue={task?.title} placeholder="e.g. Design 6 Diwali creatives for Instagram" />
      </Field>
      <Field label="Description / brief" className="sm:col-span-2">
        <Textarea name="description" rows={4} defaultValue={task?.description ?? ''} placeholder="Objective, audience, references, mandatories…" />
      </Field>
      <Field label="Project">
        <Select name="project_id" defaultValue={task?.project_id ?? defaults?.project_id ?? ''}>
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.client?.name ? `${p.client.name} — ` : ''}
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Assignee">
        <Select name="assignee_id" defaultValue={task?.assignee_id ?? defaults?.assignee_id ?? ''}>
          <option value="">Unassigned</option>
          {team.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {displayName(m.profile)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Status">
        <Select name="status" defaultValue={task?.status ?? defaults?.status ?? 'todo'}>
          {TASK_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Priority">
        <Select name="priority" defaultValue={task?.priority ?? 'medium'}>
          {TASK_PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Due date">
        <Input name="due_date" type="date" defaultValue={task?.due_date ?? ''} />
      </Field>
      <Field label="Estimate (hours)">
        <Input name="estimate_hours" type="number" min="0" step="0.25" defaultValue={task?.estimate_hours ?? ''} />
      </Field>
      <Field label="Revisions included" hint="You'll see a warning once the client goes past this.">
        <Input name="max_revisions" type="number" min="0" defaultValue={task?.max_revisions ?? ''} />
      </Field>
      <Field label="Tags" hint="Comma separated, e.g. instagram, reel">
        <Input name="tags" defaultValue={task?.tags?.join(', ') ?? ''} />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
