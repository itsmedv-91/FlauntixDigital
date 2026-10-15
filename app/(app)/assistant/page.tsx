import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getContext } from '@/lib/auth';
import { getPlan } from '@/lib/plan';
import { askQuestion } from '@/lib/actions/assistant';
import { assistantConfigured } from '@/lib/ai';
import { SubmitButton } from '@/components/submit-button';
import { Card, EmptyState, Field, PageHeader, Select, Textarea } from '@/components/ui';
import { formatDateTime } from '@/lib/utils';

export const metadata = { title: 'Assistant' };

const EXAMPLES = [
  'What is waiting on a client right now?',
  'Which tasks are overdue, and whose are they?',
  'Which client lost us money this month?',
  'What is going out next week, and for whom?',
  'Who is on leave in the next two weeks?',
];

export default async function AssistantPage() {
  const ctx = await getContext();
  // Hiding the nav link is not enforcement; the page has to refuse too.
  if (!(await getPlan()).has('assistant')) notFound();

  const [{ data: convs }, { data: clients }] = await Promise.all([
    ctx.supabase
      .from('assistant_conversations')
      .select('id, title, created_at, updated_at, client:clients(name)')
      .eq('agency_id', ctx.agencyId)
      .eq('user_id', ctx.user.id)
      .order('updated_at', { ascending: false })
      .limit(50),
    ctx.supabase.from('clients').select('id, name').eq('agency_id', ctx.agencyId).order('name'),
  ]);

  const threads = (convs ?? []) as unknown as {
    id: string;
    title: string;
    updated_at: string;
    client: { name: string } | null;
  }[];

  return (
    <>
      <PageHeader title="Assistant" subtitle="Ask about your clients, work and numbers" />

      {!assistantConfigured() ? (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink">Not switched on yet</h2>
          <p className="mt-2 text-sm text-zinc-600">
            The assistant needs an Anthropic API key. Add <code className="rounded bg-zinc-100 px-1">ANTHROPIC_API_KEY</code>{' '}
            to the environment (a key from{' '}
            <a className="text-brand-700 underline" href="https://console.anthropic.com/" target="_blank" rel="noreferrer">
              console.anthropic.com
            </a>
            ) and redeploy. Nothing else in the platform depends on it.
          </p>
        </Card>
      ) : (
        <Card className="p-5">
          <form action={askQuestion.bind(null, null)} className="space-y-4">
            <Field label="Your question">
              <Textarea name="question" rows={3} required placeholder="What needs my attention today?" />
            </Field>
            <Field label="About one client in particular?" hint="Optional. Keeps the whole thread focused on them.">
              <Select name="client_id" defaultValue="">
                <option value="">All clients</option>
                {(clients ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <SubmitButton pendingText="Thinking…">Ask</SubmitButton>
          </form>

          <div className="mt-5 border-t border-zinc-200/70 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">For example</p>
            <ul className="mt-2 space-y-1 text-sm text-zinc-600">
              {EXAMPLES.map((e) => (
                <li key={e}>· {e}</li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      <p className="mt-4 text-xs text-zinc-500">
        It reads the same data you can see — nothing more — and it cannot change anything. Questions and answers are kept
        for the agency&apos;s audit log.
      </p>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-ink">Your questions</h2>
      {threads.length === 0 ? (
        <EmptyState title="Nothing asked yet" body="Your threads will show up here." />
      ) : (
        <Card className="divide-y divide-zinc-200/70">
          {threads.map((t) => (
            <Link key={t.id} href={`/assistant/${t.id}`} className="block px-4 py-3 hover:bg-zinc-50">
              <p className="truncate text-sm font-medium text-ink">{t.title}</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {t.client ? `${t.client.name} · ` : ''}
                {formatDateTime(t.updated_at)}
              </p>
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}
