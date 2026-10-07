import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/** One row per client this contact covers (usually exactly one). */
export interface PortalMe {
  contact_id: string;
  name: string;
  email: string | null;
  designation: string | null;
  client_id: string;
  client_name: string;
  agency_id: string;
  agency_name: string;
}

export interface PortalContentRow {
  id: string;
  client_id: string;
  client_name: string;
  agency_name: string;
  title: string;
  caption: string | null;
  hashtags: string[] | null;
  platforms: string[] | null;
  format: string;
  status: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  asset_urls: string[] | null;
  published_url: string | null;
  published_at: string | null;
  revision_count: number;
  updated_at: string;
}

/**
 * Resolves the signed-in client contact. Reads only the `portal_*` views, which
 * are scoped to the caller's clients and expose client-safe columns only — a
 * portal user has no row in `memberships` and cannot reach the tables directly.
 */
export const getPortalContext = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/portal/login');

  const { data } = await supabase.from('portal_me').select('*').order('client_name');
  const contacts = (data ?? []) as unknown as PortalMe[];
  if (contacts.length === 0) redirect('/portal/login?error=no-access');

  return {
    supabase,
    user,
    contacts,
    contact: contacts[0],
    agencyName: contacts[0].agency_name,
    clientIds: contacts.map((c) => c.client_id),
  };
});

export type PortalContext = Awaited<ReturnType<typeof getPortalContext>>;

/** Statuses the portal shows, in the order a client cares about them. */
export const PORTAL_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  client_approval: { label: 'Needs your approval', tone: 'bg-brand-100 text-brand-800' },
  changes_requested: { label: 'Changes requested', tone: 'bg-amber-100 text-amber-800' },
  approved: { label: 'Approved', tone: 'bg-emerald-50 text-emerald-700' },
  scheduled: { label: 'Scheduled', tone: 'bg-indigo-100 text-indigo-800' },
  published: { label: 'Published', tone: 'bg-emerald-100 text-emerald-800' },
};
