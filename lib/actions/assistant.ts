'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getContext, logActivity } from '@/lib/auth';
import { buildSnapshot } from '@/lib/assistant-data';
import { ASSISTANT_MODEL, askAssistant, assistantConfigured, assistantErrorMessage } from '@/lib/ai';
import { displayName, str } from '@/lib/utils';
import { ROLES } from '@/lib/constants';
import type { AssistantTurn } from '@/lib/ai';

/** How many previous turns go back to the model. The snapshot carries the facts. */
const HISTORY_TURNS = 8;

export async function askQuestion(conversationId: string | null, fd: FormData) {
  const ctx = await getContext();
  const question = str(fd, 'question');
  if (!question) return;
  if (!assistantConfigured()) throw new Error('The assistant is not configured on this deployment.');

  let convId = conversationId;
  if (!convId) {
    const { data, error } = await ctx.supabase
      .from('assistant_conversations')
      .insert({
        agency_id: ctx.agencyId,
        user_id: ctx.user.id,
        client_id: str(fd, 'client_id'),
        // The first question is the best title we will ever have.
        title: question.slice(0, 80),
      })
      .select('id, client_id')
      .single();
    if (error) throw new Error(error.message);
    convId = data.id;
  }

  const { data: conv } = await ctx.supabase
    .from('assistant_conversations')
    .select('client_id')
    .eq('id', convId)
    .single();

  // Record the question first, so a failed API call still leaves a trail.
  await ctx.supabase.from('assistant_messages').insert({
    conversation_id: convId,
    agency_id: ctx.agencyId,
    role: 'user',
    body: question,
  });

  const { data: prior } = await ctx.supabase
    .from('assistant_messages')
    .select('role, body, error')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_TURNS + 1);

  // Newest first from the query, and the last row is the question we just
  // inserted — drop it, it is passed separately. Failed turns are dropped too:
  // an error message is not something the model said.
  const history: AssistantTurn[] = ((prior ?? []) as { role: 'user' | 'assistant'; body: string; error: string | null }[])
    .slice(1)
    .filter((m) => !m.error)
    .reverse()
    .map((m) => ({ role: m.role, body: m.body }));

  const roleLabel = ROLES.find((r) => r.value === ctx.role)?.label ?? ctx.role;
  const snapshot = await buildSnapshot(ctx, conv?.client_id ?? null);

  try {
    const answer = await askAssistant({
      snapshot,
      who: `${displayName(ctx.profile)}, ${roleLabel} at ${ctx.agency.name}`,
      history,
      question,
    });
    await ctx.supabase.from('assistant_messages').insert({
      conversation_id: convId,
      agency_id: ctx.agencyId,
      role: 'assistant',
      body: answer.text,
      model: answer.model,
      input_tokens: answer.inputTokens,
      output_tokens: answer.outputTokens,
    });
    await logActivity(ctx, 'assistant', convId, 'asked');
  } catch (e) {
    // Stored rather than thrown: the thread should show what went wrong next to
    // the question, and an admin should be able to see that it happened.
    await ctx.supabase.from('assistant_messages').insert({
      conversation_id: convId,
      agency_id: ctx.agencyId,
      role: 'assistant',
      body: assistantErrorMessage(e),
      model: ASSISTANT_MODEL,
      error: e instanceof Error ? e.name : 'unknown',
    });
  }

  revalidatePath('/assistant');
  revalidatePath(`/assistant/${convId}`);
  if (!conversationId) redirect(`/assistant/${convId}`);
}

export async function deleteConversation(id: string) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.from('assistant_conversations').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/assistant');
  redirect('/assistant');
}
