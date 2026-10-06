import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, getTeam } from '@/lib/auth';
import { createChannel } from '@/lib/actions/team';
import type { Channel, Message } from '@/lib/types';
import { MessagePane, type ChatPerson } from '@/components/message-pane';
import { SubmitButton } from '@/components/submit-button';
import { Card, CardHeader, Disclosure, Field, Input, PageHeader, Select } from '@/components/ui';
import { cn, displayName } from '@/lib/utils';

const GROUPS: { kind: Channel['kind']; label: string }[] = [
  { kind: 'general', label: 'General' },
  { kind: 'client', label: 'Clients' },
  { kind: 'project', label: 'Projects' },
  { kind: 'department', label: 'Departments' },
];

export default async function ChannelPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const ctx = await getContext();

  const [{ data: channels }, { data: channel }, team] = await Promise.all([
    ctx.supabase
      .from('channels')
      .select('id, name, kind, client_id, project_id, created_at')
      .eq('agency_id', ctx.agencyId)
      .order('kind')
      .order('name'),
    ctx.supabase
      .from('channels')
      .select('id, name, kind, client_id, project_id, created_at, client:clients(name), project:projects(name)')
      .eq('id', channelId)
      .eq('agency_id', ctx.agencyId)
      .maybeSingle(),
    getTeam(),
  ]);
  if (!channel) notFound();

  const [{ data: messageRows }, { data: clients }] = await Promise.all([
    ctx.supabase
      .from('messages')
      .select('id, channel_id, author_id, body, created_at')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false })
      .limit(100),
    ctx.isStaff
      ? ctx.supabase.from('clients').select('id, name').eq('agency_id', ctx.agencyId).order('name')
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const current = channel as unknown as Channel & { client: { name: string } | null; project: { name: string } | null };
  const messages = ((messageRows ?? []) as unknown as Message[]).slice().reverse();
  const people: ChatPerson[] = team.map((m) => ({ id: m.user_id, name: displayName(m.profile) }));
  const rooms = (channels ?? []) as unknown as Channel[];
  const subject = current.client?.name ?? current.project?.name;

  return (
    <>
      <PageHeader
        title={`#${current.name}`}
        subtitle={subject ? `${GROUPS.find((g) => g.kind === current.kind)?.label} · ${subject}` : GROUPS.find((g) => g.kind === current.kind)?.label}
      />

      <div className="grid gap-5 lg:grid-cols-[14rem,1fr]">
        <div className="space-y-4">
          <Card className="py-2">
            {GROUPS.map((g) => {
              const items = rooms.filter((c) => c.kind === g.kind);
              if (items.length === 0) return null;
              return (
                <div key={g.kind} className="px-2 py-1.5">
                  <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{g.label}</p>
                  <ul>
                    {items.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/chat/${c.id}`}
                          className={cn(
                            'block truncate rounded-lg px-2 py-1.5 text-sm',
                            c.id === channelId ? 'bg-ink font-medium text-white' : 'text-zinc-600 hover:bg-zinc-100 hover:text-ink',
                          )}
                        >
                          #{c.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </Card>

          {ctx.isStaff && (
            <Disclosure summary="New channel">
              <form action={createChannel} className="space-y-3">
                <Field label="Name" hint="Lower case, dashes instead of spaces">
                  <Input name="name" required placeholder="e.g. design-team" />
                </Field>
                <Field label="Kind">
                  <Select name="kind" defaultValue="department">
                    <option value="department">Department</option>
                    <option value="general">General</option>
                    <option value="client">Client</option>
                  </Select>
                </Field>
                <Field label="Client" hint="Only for client channels">
                  <Select name="client_id" defaultValue="">
                    <option value="">No client</option>
                    {(clients ?? []).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                </Field>
                <SubmitButton>Create channel</SubmitButton>
              </form>
            </Disclosure>
          )}
        </div>

        <Card className="overflow-hidden">
          <CardHeader
            title={`#${current.name}`}
            subtitle={`${people.length} people in this agency · last 100 messages`}
          />
          <MessagePane
            key={channelId}
            channelId={channelId}
            agencyId={ctx.agencyId}
            userId={ctx.user.id}
            initialMessages={messages}
            people={people}
          />
        </Card>
      </div>
    </>
  );
}
