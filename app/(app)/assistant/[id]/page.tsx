import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/auth';
import { getPlan } from '@/lib/plan';
import { askQuestion, deleteConversation } from '@/lib/actions/assistant';
import { ASSISTANT_MODEL } from '@/lib/ai';
import { SubmitButton } from '@/components/submit-button';
import { Card, Field, PageHeader, Textarea } from '@/components/ui';
import { displayName, formatDateTime } from '@/lib/utils';

export const metadata = { title: 'Assistant' };

export default async function AssistantThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  // Hiding the nav link is not enforcement; the page has to refuse too.
  if (!(await getPlan()).has('assistant')) notFound();

  const [{ data: conv }, { data: msgs }] = await Promise.all([
    ctx.supabase
      .from('assistant_conversations')
      .select('id, title, user_id, created_at, client:clients(id, name)')
      .eq('id', id)
      .maybeSingle(),
    ctx.supabase
      .from('assistant_messages')
      .select('id, role, body, model, input_tokens, output_tokens, error, created_at')
      .eq('conversation_id', id)
      .order('created_at'),
  ]);
  if (!conv) notFound();

  const thread = conv as unknown as {
    id: string;
    title: string;
    user_id: string;
    client: { id: string; name: string } | null;
  };
  const mine = thread.user_id === ctx.user.id;
  const messages = (msgs ?? []) as {
    id: string;
    role: 'user' | 'assistant';
    body: string;
    model: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    error: string | null;
    created_at: string;
  }[];

  return (
    <>
      <PageHeader
        title={thread.title}
        subtitle={thread.client ? `About ${thread.client.name}` : undefined}
        back={{ href: '/assistant', label: 'Assistant' }}
        actions={
          mine ? (
            <form action={deleteConversation.bind(null, thread.id)}>
              <SubmitButton variant="ghost" confirm="Delete this thread?" pendingText="Deleting…">
                Delete
              </SubmitButton>
            </form>
          ) : undefined
        }
      />

      {!mine && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          You are reading someone else&apos;s thread as an admin. You cannot add to it.
        </p>
      )}

      <div className="space-y-3">
        {messages.map((m) => (
          <Card
            key={m.id}
            className={
              m.role === 'user'
                ? 'border-brand-200 bg-brand-50/60 p-4'
                : m.error
                  ? 'border-red-200 bg-red-50 p-4'
                  : 'p-4'
            }
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              {m.role === 'user' ? displayName(ctx.profile) : m.error ? 'Failed' : 'Assistant'} ·{' '}
              {formatDateTime(m.created_at)}
            </p>
            <div className="mt-2 whitespace-pre-wrap text-sm text-ink">{m.body}</div>
            {m.role === 'assistant' && !m.error && (
              <p className="mt-2 text-[11px] text-zinc-400">
                {m.model}
                {m.input_tokens !== null && ` · ${m.input_tokens} in / ${m.output_tokens} out`}
              </p>
            )}
          </Card>
        ))}
      </div>

      {mine && (
        <Card className="mt-5 p-4">
          <form action={askQuestion.bind(null, thread.id)} className="space-y-3">
            <Field label="Follow up">
              <Textarea name="question" rows={2} required placeholder="Ask something else…" />
            </Field>
            <SubmitButton pendingText="Thinking…">Ask</SubmitButton>
          </form>
        </Card>
      )}

      <p className="mt-4 text-xs text-zinc-500">
        Answered by {ASSISTANT_MODEL} from a snapshot of what you can see. It has no ability to change anything, and{' '}
        <Link href="/settings" className="underline">
          nothing here is sent anywhere else
        </Link>
        .
      </p>
    </>
  );
}
