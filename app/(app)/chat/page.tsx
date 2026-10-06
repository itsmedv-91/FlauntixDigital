import { redirect } from 'next/navigation';
import { getContext } from '@/lib/auth';
import { EmptyState, PageHeader } from '@/components/ui';

export const metadata = { title: 'Chat' };

export default async function ChatIndexPage() {
  const ctx = await getContext();

  const { data } = await ctx.supabase
    .from('channels')
    .select('id, kind, name')
    .eq('agency_id', ctx.agencyId)
    .order('created_at')
    .limit(50);

  const channels = data ?? [];
  const first = channels.find((c) => c.kind === 'general' && c.name === 'general') ?? channels[0];
  if (first) redirect(`/chat/${first.id}`);

  return (
    <>
      <PageHeader title="Chat" />
      <EmptyState
        title="No channels yet"
        body="Channels are created with your agency and whenever a lead becomes a client. Ask an admin to set one up."
      />
    </>
  );
}
