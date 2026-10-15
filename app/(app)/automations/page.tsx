import { notFound } from 'next/navigation';
import { getContext, getTeam } from '@/lib/auth';
import { createRule, deleteRule, runNow, toggleRule } from '@/lib/actions/automations';
import { AUTOMATION_ACTIONS, AUTOMATION_TRIGGERS } from '@/lib/constants';
import { displayName, formatDateTime } from '@/lib/utils';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Card, CardHeader, Disclosure, EmptyState, Field, Input, PageHeader, Select, Stat } from '@/components/ui';
import type { AutomationEvent, AutomationRule } from '@/lib/types';

export const metadata = { title: 'Automations' };

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  if (!ctx.isManager) notFound();

  const [{ data: rules }, { data: events }, { data: clients }, { data: channels }, team] = await Promise.all([
    ctx.supabase.from('automation_rules').select('*').eq('agency_id', ctx.agencyId).order('created_at'),
    ctx.supabase
      .from('automation_events')
      .select('id, rule_id, entity_type, entity_id, summary, created_at, dedupe_key')
      .eq('agency_id', ctx.agencyId)
      .order('created_at', { ascending: false })
      .limit(50),
    ctx.supabase.from('clients').select('id, name').eq('agency_id', ctx.agencyId).order('name'),
    ctx.supabase.from('channels').select('id, name').eq('agency_id', ctx.agencyId).order('name'),
    getTeam(),
  ]);

  const list = (rules ?? []) as AutomationRule[];
  const log = (events ?? []) as AutomationEvent[];
  const names = new Map(list.map((r) => [r.id, r.name]));
  const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const channelName = new Map((channels ?? []).map((c) => [c.id, c.name]));

  return (
    <>
      <PageHeader
        title="Automations"
        subtitle="If this happens, do that"
        actions={
          list.some((r) => r.active) ? (
            <form action={runNow}>
              <SubmitButton variant="secondary" pendingText="Running…">
                Run now
              </SubmitButton>
            </form>
          ) : undefined
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Rules" value={list.length} />
        <Stat label="Active" value={list.filter((r) => r.active).length} />
        <Stat label="Things done" value={log.length >= 50 ? '50+' : log.length} />
        <Stat
          label="Last run"
          value={
            list.some((r) => r.last_run_at)
              ? formatDateTime(
                  list
                    .map((r) => r.last_run_at)
                    .filter(Boolean)
                    .sort()
                    .at(-1),
                )
              : 'never'
          }
        />
      </div>

      <div className="mb-5">
        <Disclosure summary="New automation" open={sp.new === '1' || list.length === 0}>
          <form action={createRule} className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" hint="Shown in the chat message or task it creates.">
              <Input name="name" required placeholder="Chase overdue invoices" />
            </Field>
            <Field label="Run when">
              <Select name="trigger" required defaultValue="task_overdue">
                {AUTOMATION_TRIGGERS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Threshold in days"
              hint="Days overdue, days with the client, or days ahead — depending on the trigger above."
            >
              <Input name="threshold_days" type="number" min={0} max={365} defaultValue={1} />
            </Field>
            <Field label="Only for this client" hint="Leave blank to cover every client.">
              <Select name="client_id" defaultValue="">
                <option value="">Every client</option>
                {(clients ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Then">
              <Select name="action" required defaultValue="chat_message">
                {AUTOMATION_ACTIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Channel" hint="Used when the action is a chat message.">
              <Select name="channel_id" defaultValue="">
                <option value="">Choose a channel…</option>
                {(channels ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Assign the task to" hint="Used when the action opens a task.">
              <Select name="assignee_id" defaultValue="">
                <option value="">Nobody</option>
                {team
                  .filter((m) => m.active)
                  .map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {displayName(m.profile)}
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton pendingText="Saving…">Create automation</SubmitButton>
              <p className="mt-2 text-xs text-zinc-500">
                Each rule acts on a given task, invoice or post <strong>once</strong> — pressing “Run now” twice does not
                repeat anything. If pg_cron is enabled on the Supabase project, rules also run hourly on their own.
              </p>
            </div>
          </form>
        </Disclosure>
      </div>

      {list.length === 0 ? (
        <EmptyState title="No automations yet" body="Start with chasing overdue invoices or content stuck with a client." />
      ) : (
        <Card className="mb-6 divide-y divide-zinc-200/70">
          {list.map((r) => {
            const trigger = AUTOMATION_TRIGGERS.find((t) => t.value === r.trigger);
            const action = AUTOMATION_ACTIONS.find((a) => a.value === r.action);
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink">
                    {r.name}
                    {r.active ? (
                      <Badge className="bg-emerald-100 text-emerald-800">Active</Badge>
                    ) : (
                      <Badge className="bg-zinc-200 text-zinc-500">Paused</Badge>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {trigger?.label} ({r.threshold_days}d) → {action?.label}
                    {r.channel_id && ` #${channelName.get(r.channel_id) ?? '—'}`}
                    {r.client_id && ` · ${clientName.get(r.client_id) ?? 'a client'} only`}
                    {r.last_run_at && ` · last run ${formatDateTime(r.last_run_at)}`}
                  </p>
                </div>
                <form action={toggleRule.bind(null, r.id)}>
                  <input type="hidden" name="active" value={r.active ? '0' : '1'} />
                  <SubmitButton variant="ghost" size="sm">
                    {r.active ? 'Pause' : 'Resume'}
                  </SubmitButton>
                </form>
                <form action={deleteRule.bind(null, r.id)}>
                  <SubmitButton variant="ghost" size="sm" confirm={`Delete “${r.name}”?`}>
                    Delete
                  </SubmitButton>
                </form>
              </div>
            );
          })}
        </Card>
      )}

      <Card>
        <CardHeader title="What the automations did" subtitle="Most recent first" />
        {log.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-zinc-500">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200/70">
            {log.map((e) => (
              <li key={e.id} className="px-4 py-2.5">
                <p className="text-sm text-ink">{e.summary}</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {names.get(e.rule_id) ?? 'a deleted rule'} · {formatDateTime(e.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
