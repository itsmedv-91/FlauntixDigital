'use server';

import { revalidatePath } from 'next/cache';
import { assertRole, getContext } from '@/lib/auth';
import { STAFF_ROLES } from '@/lib/constants';
import { num, str } from '@/lib/utils';

function refresh(clientId?: string | null) {
  revalidatePath('/seo');
  if (clientId) revalidatePath(`/seo?client=${clientId}`);
}

export async function addKeyword(fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);
  const clientId = str(fd, 'client_id');
  const keyword = str(fd, 'keyword');
  if (!clientId) throw new Error('Choose the client this keyword belongs to.');
  if (!keyword) throw new Error('Enter the keyword.');

  const { error } = await ctx.supabase.from('seo_keywords').insert({
    agency_id: ctx.agencyId,
    client_id: clientId,
    keyword,
    target_url: str(fd, 'target_url'),
    search_volume: num(fd, 'search_volume'),
    difficulty: num(fd, 'difficulty'),
    priority: num(fd, 'priority') ?? 2,
    notes: str(fd, 'notes'),
  });
  // The unique (client, keyword) constraint is the useful error here.
  if (error) {
    throw new Error(
      error.code === '23505' || error.message.includes('duplicate')
        ? `“${keyword}” is already tracked for this client.`
        : error.message,
    );
  }
  refresh(clientId);
}

export async function archiveKeyword(id: string, clientId: string) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);
  const { error } = await ctx.supabase.from('seo_keywords').update({ active: false }).eq('id', id);
  if (error) throw new Error(error.message);
  refresh(clientId);
}

/**
 * Records one check. Upserts on (keyword, date) so re-pasting a day's figures
 * corrects them instead of creating a second row for the same day.
 *
 * A blank position means "not in the top 100", which is a real answer and is
 * stored as null — different from not having checked at all, which is simply
 * the absence of a row.
 */
export async function recordRanking(keywordId: string, clientId: string, fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);
  const checkedOn = str(fd, 'checked_on');
  if (!checkedOn) throw new Error('Set the date this was checked.');

  const { error } = await ctx.supabase.from('seo_rankings').upsert(
    {
      agency_id: ctx.agencyId,
      keyword_id: keywordId,
      checked_on: checkedOn,
      position: num(fd, 'position'),
      ranking_url: str(fd, 'ranking_url'),
      source: str(fd, 'source'),
    },
    { onConflict: 'keyword_id,checked_on' },
  );
  if (error) throw new Error(error.message);
  refresh(clientId);
}

/**
 * Pastes a block of `keyword,position` lines from whatever rank tracker the
 * agency uses. Unknown keywords are reported rather than silently created:
 * a typo creating a second keyword row is worse than being told about it.
 */
export async function importRankings(fd: FormData) {
  const ctx = await getContext();
  assertRole(ctx, STAFF_ROLES);
  const clientId = str(fd, 'client_id');
  const checkedOn = str(fd, 'checked_on');
  const block = str(fd, 'block');
  if (!clientId || !checkedOn || !block) throw new Error('Client, date and the pasted rows are all needed.');

  const { data: keywords } = await ctx.supabase
    .from('seo_keywords')
    .select('id, keyword')
    .eq('client_id', clientId);
  const byKeyword = new Map((keywords ?? []).map((k) => [k.keyword.toLowerCase(), k.id]));

  const rows: { agency_id: string; keyword_id: string; checked_on: string; position: number | null; source: string }[] = [];
  const unknown: string[] = [];

  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Split on the LAST comma or tab, so a keyword containing a comma survives.
    const m = trimmed.match(/^(.*)[,\t]\s*([^,\t]*)$/);
    if (!m) {
      unknown.push(trimmed);
      continue;
    }
    const id = byKeyword.get(m[1].trim().toLowerCase());
    if (!id) {
      unknown.push(m[1].trim());
      continue;
    }
    const pos = Number(m[2].trim());
    rows.push({
      agency_id: ctx.agencyId,
      keyword_id: id,
      checked_on: checkedOn,
      // Anything outside 1–100 is treated as "not ranking", same as blank.
      position: Number.isFinite(pos) && pos >= 1 && pos <= 100 ? Math.round(pos) : null,
      source: str(fd, 'source') ?? 'pasted',
    });
  }

  if (rows.length) {
    const { error } = await ctx.supabase
      .from('seo_rankings')
      .upsert(rows, { onConflict: 'keyword_id,checked_on' });
    if (error) throw new Error(error.message);
  }
  refresh(clientId);
  if (unknown.length) {
    throw new Error(
      `Saved ${rows.length} row(s). Not tracked for this client, so skipped: ${unknown.slice(0, 8).join(', ')}` +
        (unknown.length > 8 ? ` and ${unknown.length - 8} more` : ''),
    );
  }
}
