import { CONTENT_FORMATS, CONTENT_PLATFORMS, CONTENT_STATUSES } from '@/lib/constants';
import type { ContentItem, Profile } from '@/lib/types';
import { displayName } from '@/lib/utils';
import { SubmitButton } from './submit-button';
import { Field, Input, Select, Textarea } from './ui';

export function ContentForm({
  action,
  clients,
  projects,
  team,
  item,
  defaults,
  submitLabel = 'Add to calendar',
  redirectTo,
}: {
  action: (fd: FormData) => Promise<void>;
  clients: { id: string; name: string }[];
  projects: { id: string; name: string; client_id?: string | null }[];
  team: { user_id: string; profile: Profile | null }[];
  item?: ContentItem;
  defaults?: { client_id?: string; scheduled_date?: string; status?: string };
  submitLabel?: string;
  redirectTo?: string;
}) {
  const platforms = item?.platforms ?? [];
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      {redirectTo && <input type="hidden" name="redirect_to" value={redirectTo} />}

      <Field label="Title" className="sm:col-span-2" hint="What the team calls this post internally">
        <Input name="title" required defaultValue={item?.title} placeholder="e.g. Diwali offer — carousel 1 of 3" />
      </Field>

      <Field label="Client">
        <Select name="client_id" required defaultValue={item?.client_id ?? defaults?.client_id ?? ''}>
          <option value="">Choose a client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Campaign / project">
        <Select name="project_id" defaultValue={item?.project_id ?? ''}>
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </Field>

      <Field label="Format">
        <Select name="format" defaultValue={item?.format ?? 'static'}>
          {CONTENT_FORMATS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Status">
        <Select name="status" defaultValue={item?.status ?? defaults?.status ?? 'idea'}>
          {CONTENT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </Select>
      </Field>

      <Field label="Publish date" hint="Leave empty to park it in the unscheduled tray">
        <Input name="scheduled_date" type="date" defaultValue={item?.scheduled_date ?? defaults?.scheduled_date ?? ''} />
      </Field>
      <Field label="Publish time (IST)">
        <Input name="scheduled_time" type="time" defaultValue={item?.scheduled_time?.slice(0, 5) ?? ''} />
      </Field>

      <Field label="Owner" hint="Designer or writer producing this">
        <Select name="assignee_id" defaultValue={item?.assignee_id ?? ''}>
          <option value="">Unassigned</option>
          {team.map((m) => (
            <option key={m.user_id} value={m.user_id}>{displayName(m.profile)}</option>
          ))}
        </Select>
      </Field>
      <Field label="Revisions included" hint="You'll see a warning once the client goes past this.">
        <Input name="max_revisions" type="number" min="0" defaultValue={item?.max_revisions ?? ''} />
      </Field>

      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-xs font-medium text-zinc-600">Platforms</legend>
        <div className="grid gap-1.5 sm:grid-cols-3">
          {CONTENT_PLATFORMS.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" name="platforms" value={p} defaultChecked={platforms.includes(p)} />
              {p}
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Caption / copy" className="sm:col-span-2">
        <Textarea name="caption" rows={5} defaultValue={item?.caption ?? ''} placeholder="The actual caption that goes out…" />
      </Field>
      <Field label="Hashtags" className="sm:col-span-2" hint="Comma separated, with or without #">
        <Input name="hashtags" defaultValue={item?.hashtags?.join(', ') ?? ''} placeholder="diwali, offers, mumbai" />
      </Field>
      <Field label="Creative links" className="sm:col-span-2" hint="One link per line — Drive, Figma, Dropbox">
        <Textarea name="asset_urls" rows={3} defaultValue={item?.asset_urls?.join('\n') ?? ''} />
      </Field>
      <Field label="Internal notes" className="sm:col-span-2">
        <Textarea name="notes" rows={2} defaultValue={item?.notes ?? ''} placeholder="Shoot references, mandatories, do-not-use…" />
      </Field>

      <div className="sm:col-span-2">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
