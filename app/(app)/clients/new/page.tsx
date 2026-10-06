import { notFound } from 'next/navigation';
import { getContext, getTeam } from '@/lib/auth';
import { createClientRecord } from '@/lib/actions/clients';
import { ClientForm } from '@/components/client-form';
import { Card, PageHeader } from '@/components/ui';

export const metadata = { title: 'New client' };

export default async function NewClientPage() {
  const ctx = await getContext();
  if (!ctx.isManager) notFound();
  const team = await getTeam();
  return (
    <>
      <PageHeader back={{ href: '/clients', label: 'Clients' }} title="New client" subtitle="A chat channel is created for every new client." />
      <Card className="max-w-3xl p-6">
        <ClientForm action={createClientRecord} team={team} />
      </Card>
    </>
  );
}
