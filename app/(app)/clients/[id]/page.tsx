import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, getTeam } from '@/lib/auth';
import { addContact, deleteClientRecord, deleteContact, updateClientRecord } from '@/lib/actions/clients';
import { addCredential, deleteCredential } from '@/lib/actions/vault';
import { createProject } from '@/lib/actions/projects';
import { CLIENT_STATUSES, PROJECT_STATUSES, VAULT_PLATFORMS } from '@/lib/constants';
import type { Client, ClientContact, Credential } from '@/lib/types';
import { ClientForm } from '@/components/client-form';
import { ProjectForm } from '@/components/project-form';
import { RevealSecret } from '@/components/reveal-secret';
import { SubmitButton } from '@/components/submit-button';
import { TASK_SELECT, TaskRow, type TaskListItem } from '@/components/task-bits';
import { Badge, Card, CardHeader, Disclosure, EmptyState, Field, Input, PageHeader, Select, Stat, Textarea } from '@/components/ui';
import { cn, displayName, formatDate, formatDateTime, formatINR, formatMinutes } from '@/lib/utils';

type Tab = 'overview' | 'work' | 'contacts' | 'vault' | 'edit';

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: Tab }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const ctx = await getContext();

  const { data: client } = await ctx.supabase
    .from('clients')
    .select('*, manager:profiles(full_name, email)')
    .eq('id', id)
    .eq('agency_id', ctx.agencyId)
    .maybeSingle();
  if (!client) notFound();
  const c = client as Client & { manager: { full_name: string | null; email: string | null } | null };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'work', label: 'Projects & tasks' },
    { key: 'contacts', label: 'Contacts' },
    ...(ctx.isManager ? ([{ key: 'vault', label: 'Credentials vault' }, { key: 'edit', label: 'Edit' }] as { key: Tab; label: string }[]) : []),
  ];
  const tab: Tab = tabs.some((t) => t.key === rawTab) ? rawTab! : 'overview';
  const st = CLIENT_STATUSES.find((s) => s.value === c.status);

  return (
    <>
      <PageHeader
        back={{ href: '/clients', label: 'Clients' }}
        title={c.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge className={st?.tone}>{st?.label}</Badge>
            {c.industry && <span>{c.industry}</span>}
            {c.website && (
              <a href={c.website} target="_blank" rel="noreferrer" className="hover:text-brand-600">
                {c.website.replace(/^https?:\/\//, '')}
              </a>
            )}
            <span>· Manager: {displayName(c.manager)}</span>
          </span>
        }
      />

      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-zinc-200 text-sm">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/clients/${id}${t.key === 'overview' ? '' : `?tab=${t.key}`}`}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 font-medium',
              tab === t.key ? 'border-brand-500 text-brand-700' : 'border-transparent text-zinc-500 hover:text-ink',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'overview' && <Overview ctx={ctx} c={c} />}
      {tab === 'work' && <Work ctx={ctx} c={c} />}
      {tab === 'contacts' && <Contacts ctx={ctx} c={c} />}
      {tab === 'vault' && <Vault ctx={ctx} c={c} />}
      {tab === 'edit' && <Edit c={c} isAdmin={ctx.isAdmin} />}
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof getContext>>;

async function Overview({ ctx, c }: { ctx: Ctx; c: Client }) {
  const [{ data: tasks }, { data: time }, { data: contacts }] = await Promise.all([
    ctx.supabase.from('tasks').select('status, due_date').eq('client_id', c.id),
    ctx.isManager
      ? ctx.supabase.from('time_entries').select('minutes, started_at').eq('client_id', c.id)
      : Promise.resolve({ data: [] as { minutes: number | null; started_at: string }[] }),
    ctx.supabase.from('client_contacts').select('*').eq('client_id', c.id).eq('is_primary', true).limit(1),
  ]);
  const open = (tasks ?? []).filter((t) => t.status !== 'done');
  const approval = open.filter((t) => t.status === 'client_approval').length;
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthMinutes = (time ?? []).filter((e) => new Date(e.started_at) >= monthStart).reduce((s, e) => s + (e.minutes ?? 0), 0);
  const primary = (contacts ?? [])[0] as ClientContact | undefined;
  const colors = (c.brand_colors ?? '').match(/#[0-9a-fA-F]{3,8}/g) ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open tasks" value={open.length} />
        <Stat label="Awaiting their approval" value={approval} tone={approval > 3 ? 'warn' : undefined} />
        {ctx.isManager && <Stat label="Hours this month" value={formatMinutes(monthMinutes)} />}
        {ctx.isManager && <Stat label="Monthly retainer" value={formatINR(c.monthly_retainer)} hint={c.contract_end ? `Contract ends ${formatDate(c.contract_end, true)}` : undefined} />}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Brand kit" />
          <div className="space-y-4 p-5 text-sm">
            <div>
              <p className="text-xs font-medium text-zinc-500">Colours</p>
              {colors.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {colors.map((hex) => (
                    <span key={hex} className="flex items-center gap-1.5 rounded-lg border border-zinc-200 py-1 pl-1 pr-2 text-xs">
                      <span className="h-5 w-5 rounded" style={{ backgroundColor: hex }} /> {hex}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-zinc-400">Not added</p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-500">Tone of voice</p>
              <p className="mt-1 text-zinc-700">{c.brand_voice ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-500">Services</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(c.services ?? []).length ? c.services!.map((s) => <Badge key={s} className="bg-brand-50 text-brand-700">{s}</Badge>) : <span className="text-zinc-400">—</span>}
              </div>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Key details" />
          <dl className="grid grid-cols-[120px_1fr] gap-y-3 p-5 text-sm">
            <dt className="text-zinc-500">Primary contact</dt>
            <dd>{primary ? `${primary.name}${primary.designation ? `, ${primary.designation}` : ''}` : '—'}</dd>
            <dt className="text-zinc-500">Email / phone</dt>
            <dd className="truncate">{[primary?.email, primary?.phone].filter(Boolean).join(' · ') || '—'}</dd>
            <dt className="text-zinc-500">Contract</dt>
            <dd>{c.contract_start || c.contract_end ? `${formatDate(c.contract_start, true)} → ${formatDate(c.contract_end, true)}` : '—'}</dd>
            <dt className="text-zinc-500">Client since</dt>
            <dd>{formatDate(c.created_at, true)}</dd>
          </dl>
          {c.notes && <p className="whitespace-pre-wrap border-t border-zinc-100 px-5 py-4 text-sm text-zinc-600">{c.notes}</p>}
        </Card>
      </div>
    </div>
  );
}

async function Work({ ctx, c }: { ctx: Ctx; c: Client }) {
  const [team, { data: projects }, { data: tasks }] = await Promise.all([
    getTeam(),
    ctx.supabase.from('projects').select('id, name, status, due_date, tasks(status)').eq('client_id', c.id).order('created_at', { ascending: false }),
    ctx.supabase.from('tasks').select(TASK_SELECT).eq('client_id', c.id).neq('status', 'done').order('due_date', { ascending: true, nullsFirst: false }),
  ]);
  const rows = (projects ?? []) as unknown as { id: string; name: string; status: string; due_date: string | null; tasks: { status: string }[] }[];

  return (
    <div className="space-y-6">
      {ctx.isManager && (
        <Disclosure summary="New project for this client">
          <ProjectForm action={createProject} clients={[{ id: c.id, name: c.name }]} team={team} defaultClientId={c.id} />
        </Disclosure>
      )}
      <Card>
        <CardHeader title="Projects" />
        {rows.length ? (
          <ul className="divide-y divide-zinc-100">
            {rows.map((p) => {
              const st = PROJECT_STATUSES.find((s) => s.value === p.status);
              const done = p.tasks.filter((t) => t.status === 'done').length;
              return (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-zinc-50">
                    <span className="flex-1 truncate text-sm font-medium">{p.name}</span>
                    <span className="text-xs text-zinc-500">{done}/{p.tasks.length} done</span>
                    <Badge className={st?.tone}>{st?.label}</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-zinc-500">No projects yet.</p>
        )}
      </Card>
      <Card>
        <CardHeader title="Open tasks" />
        {(tasks ?? []).length ? (
          <div className="divide-y divide-zinc-100">
            {((tasks ?? []) as unknown as TaskListItem[]).map((t) => <TaskRow key={t.id} task={t} />)}
          </div>
        ) : (
          <p className="px-5 py-6 text-sm text-zinc-500">No open tasks.</p>
        )}
      </Card>
    </div>
  );
}

async function Contacts({ ctx, c }: { ctx: Ctx; c: Client }) {
  const { data } = await ctx.supabase.from('client_contacts').select('*').eq('client_id', c.id).order('is_primary', { ascending: false }).order('name');
  const contacts = (data ?? []) as ClientContact[];
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader title="Contacts" subtitle="People at the client you work with" />
        {contacts.length ? (
          <ul className="divide-y divide-zinc-100">
            {contacts.map((p) => (
              <li key={p.id} className="flex items-start gap-3 px-5 py-3.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">
                    {p.name} {p.is_primary && <Badge className="ml-1 bg-brand-50 text-brand-700">Primary</Badge>}
                  </p>
                  <p className="text-xs text-zinc-500">{p.designation ?? '—'}</p>
                  <p className="mt-1 text-xs text-zinc-600">
                    {p.email && <a href={`mailto:${p.email}`} className="hover:text-brand-600">{p.email}</a>}
                    {p.email && p.phone && ' · '}
                    {p.phone && <a href={`https://wa.me/${p.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="hover:text-brand-600">{p.phone}</a>}
                  </p>
                </div>
                {ctx.isManager && (
                  <form action={deleteContact.bind(null, c.id, p.id)}>
                    <button className="text-xs text-zinc-400 hover:text-red-600">Remove</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-zinc-500">No contacts yet.</p>
        )}
      </Card>
      {ctx.isManager && (
        <Card>
          <CardHeader title="Add contact" />
          <form action={addContact.bind(null, c.id)} className="space-y-3 p-5">
            <Field label="Name"><Input name="name" required /></Field>
            <Field label="Designation"><Input name="designation" placeholder="e.g. Marketing Head" /></Field>
            <Field label="Email"><Input name="email" type="email" /></Field>
            <Field label="Phone / WhatsApp"><Input name="phone" placeholder="+91 98xxx xxxxx" /></Field>
            <label className="flex items-center gap-2 text-sm text-zinc-600">
              <input type="checkbox" name="is_primary" className="accent-brand-500" /> Primary contact
            </label>
            <SubmitButton size="sm">Add contact</SubmitButton>
          </form>
        </Card>
      )}
    </div>
  );
}

async function Vault({ ctx, c }: { ctx: Ctx; c: Client }) {
  const [{ data }, { data: log }] = await Promise.all([
    ctx.supabase.from('credentials').select('id, platform, label, username, url, notes, updated_at').eq('client_id', c.id).order('platform'),
    ctx.supabase.from('activity_log').select('id, action, meta, created_at, actor:profiles(full_name, email)')
      .eq('agency_id', ctx.agencyId).eq('entity_type', 'credential').contains('meta', { client_id: c.id })
      .order('created_at', { ascending: false }).limit(10),
  ]);
  const creds = (data ?? []) as Credential[];

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader title="Stored credentials" subtitle="Encrypted with AES-256. Only managers and admins can view. Every reveal is logged." />
          {creds.length ? (
            <ul className="divide-y divide-zinc-100">
              {creds.map((cr) => (
                <li key={cr.id} className="px-5 py-3.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-ink">
                      {cr.platform}
                      {cr.label && <span className="font-normal text-zinc-500"> · {cr.label}</span>}
                    </p>
                    <form action={deleteCredential.bind(null, c.id, cr.id)}>
                      <SubmitButton variant="ghost" size="sm" confirm={`Delete the ${cr.platform} credential?`} pendingText="…">Delete</SubmitButton>
                    </form>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-zinc-600">
                    {cr.username && <span>User: <span className="font-mono">{cr.username}</span></span>}
                    <span className="flex items-center gap-1.5">Secret: <RevealSecret id={cr.id} /></span>
                    {cr.url && <a href={cr.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">Open login</a>}
                  </div>
                  {cr.notes && <p className="mt-1.5 text-xs text-zinc-500">{cr.notes}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-5"><EmptyState title="Vault is empty" body="Store this client's social, ad-account and website logins here instead of in chats or spreadsheets." /></div>
          )}
        </Card>
        <Card>
          <CardHeader title="Access log" subtitle="Last 10 vault events for this client" />
          <ul className="divide-y divide-zinc-100 text-xs">
            {((log ?? []) as unknown as { id: number; action: string; meta: { platform?: string } | null; created_at: string; actor: { full_name: string | null; email: string | null } | null }[]).map((l) => (
              <li key={l.id} className="flex justify-between gap-3 px-5 py-2.5">
                <span><span className="font-medium text-ink">{displayName(l.actor)}</span> {l.action} {l.meta?.platform ?? 'credential'}</span>
                <span className="text-zinc-400">{formatDateTime(l.created_at)}</span>
              </li>
            ))}
            {!(log ?? []).length && <li className="px-5 py-4 text-zinc-500">No vault activity yet.</li>}
          </ul>
        </Card>
      </div>
      <Card className="self-start">
        <CardHeader title="Add credential" />
        <form action={addCredential.bind(null, c.id)} className="space-y-3 p-5" autoComplete="off">
          <Field label="Platform">
            <Select name="platform" required defaultValue="">
              <option value="" disabled>Choose…</option>
              {VAULT_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label="Label" hint="Optional, e.g. Main brand account"><Input name="label" /></Field>
          <Field label="Username / email"><Input name="username" autoComplete="off" /></Field>
          <Field label="Password / secret"><Input name="secret" type="password" required autoComplete="new-password" /></Field>
          <Field label="Login URL"><Input name="url" type="url" placeholder="https://" /></Field>
          <Field label="Notes" hint="2FA method, recovery email, who owns the account…"><Textarea name="notes" rows={2} /></Field>
          <SubmitButton size="sm" pendingText="Encrypting…">Save to vault</SubmitButton>
        </form>
      </Card>
    </div>
  );
}

async function Edit({ c, isAdmin }: { c: Client; isAdmin: boolean }) {
  const team = await getTeam();
  return (
    <Card className="max-w-3xl p-6">
      <ClientForm action={updateClientRecord.bind(null, c.id)} team={team} client={c} submitLabel="Save changes" />
      {isAdmin && (
        <form action={deleteClientRecord.bind(null, c.id)} className="mt-6 border-t border-zinc-100 pt-5">
          <p className="mb-2 text-xs text-zinc-500">Deleting removes the client, its contacts, credentials and chat channel. Projects and tasks are kept but unlinked.</p>
          <SubmitButton variant="danger" size="sm" confirm={`Delete ${c.name} permanently?`} pendingText="Deleting…">Delete client</SubmitButton>
        </form>
      )}
    </Card>
  );
}
