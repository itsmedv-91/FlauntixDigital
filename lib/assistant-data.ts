/**
 * Builds the data snapshot the assistant answers from.
 *
 * Two rules shape this file:
 *
 * 1. EVERY query goes through `ctx.supabase`, the caller's own RLS-scoped
 *    client. That is what makes a freelancer's assistant see a freelancer's
 *    data: the filtering is the database's, not a list of ifs here. The only
 *    explicit role checks are for things the UI also hides and that RLS would
 *    merely return empty for — asking for them at all would be noise.
 * 2. It is BOUNDED. Every query has a limit and a window, because the snapshot
 *    is re-sent on every turn and an agency with ten thousand tasks would
 *    otherwise cost a fortune per question and bury the answer.
 *
 * The output is plain text rather than JSON: it is a third of the tokens and
 * the model reads it just as well.
 */
import 'server-only';
import type { AppContext } from '@/lib/auth';
import { addDays, formatINR, monthIST, monthRange, todayIST } from '@/lib/utils';
import type { ClientMargin } from '@/lib/types';

function section(title: string, lines: string[], empty = 'none') {
  return `## ${title}\n${lines.length ? lines.join('\n') : empty}`;
}

/** Keeps a client-supplied string from running away with the prompt. */
function clip(s: string | null | undefined, n = 120) {
  if (!s) return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

export async function buildSnapshot(ctx: AppContext, focusClientId?: string | null) {
  const today = todayIST();
  const month = monthIST();
  const { start: monthStart, end: monthEnd } = monthRange(month);
  const soon = addDays(today, 30);
  const parts: string[] = [];

  parts.push(
    `Agency: ${ctx.agency.name}\nToday: ${today} (IST)\nCurrent month: ${month}`,
  );

  // --- Clients -------------------------------------------------------------
  let clientQ = ctx.supabase
    .from('clients')
    .select('id, name, status, monthly_retainer, services, contract_end')
    .order('name')
    .limit(60);
  if (focusClientId) clientQ = clientQ.eq('id', focusClientId);
  const { data: clients } = await clientQ;

  parts.push(
    section(
      'Clients',
      (clients ?? []).map(
        (c) =>
          `- ${c.name} — ${c.status}` +
          (c.monthly_retainer ? `, retainer ${formatINR(c.monthly_retainer)}/mo` : '') +
          (c.contract_end ? `, contract ends ${c.contract_end}` : '') +
          (c.services?.length ? `, services: ${c.services.join(', ')}` : ''),
      ),
      'none visible to you',
    ),
  );

  const names = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const of = (id: string | null) => (id ? names.get(id) ?? 'another client' : 'internal');

  // --- Tasks ---------------------------------------------------------------
  const { data: tasks } = await ctx.supabase
    .from('tasks')
    .select('title, status, priority, due_date, client_id, assignee_id, revision_count, max_revisions')
    .neq('status', 'done')
    .order('due_date', { nullsFirst: false })
    .limit(80);

  parts.push(
    section(
      'Open tasks',
      (tasks ?? []).map(
        (t) =>
          `- ${clip(t.title)} [${t.status}, ${t.priority}] ${of(t.client_id)}` +
          (t.due_date ? `, due ${t.due_date}${t.due_date < today ? ' (OVERDUE)' : ''}` : '') +
          (t.assignee_id === ctx.user.id ? ', assigned to you' : '') +
          (t.max_revisions && t.revision_count > t.max_revisions ? ', over revision limit' : ''),
      ),
    ),
  );

  // --- Content -------------------------------------------------------------
  const { data: content } = await ctx.supabase
    .from('content_items')
    .select('title, status, format, platforms, scheduled_date, client_id, updated_at')
    .in('status', ['idea', 'in_progress', 'internal_review', 'client_approval', 'changes_requested', 'approved', 'scheduled'])
    .order('scheduled_date', { nullsFirst: false })
    .limit(80);

  const waiting = (content ?? []).filter((c) => c.status === 'client_approval');
  const upcoming = (content ?? []).filter(
    (c) => c.scheduled_date && c.scheduled_date >= today && c.scheduled_date <= soon,
  );

  parts.push(
    section(
      'Content waiting on a client decision',
      waiting.map((c) => `- ${clip(c.title)} — ${of(c.client_id)}, sent ${c.updated_at.slice(0, 10)}`),
    ),
  );
  parts.push(
    section(
      'Content scheduled in the next 30 days',
      upcoming.map(
        (c) =>
          `- ${c.scheduled_date}: ${clip(c.title)} — ${of(c.client_id)}, ${c.format}` +
          (c.platforms?.length ? `, ${c.platforms.join('/')}` : '') +
          `, ${c.status}`,
      ),
    ),
  );
  parts.push(
    section('Content in production', [
      `- ideas: ${(content ?? []).filter((c) => c.status === 'idea').length}`,
      `- in progress: ${(content ?? []).filter((c) => c.status === 'in_progress').length}`,
      `- internal review: ${(content ?? []).filter((c) => c.status === 'internal_review').length}`,
      `- changes requested: ${(content ?? []).filter((c) => c.status === 'changes_requested').length}`,
    ]),
  );

  // --- Time this month ----------------------------------------------------
  const { data: time } = await ctx.supabase
    .from('time_entries')
    .select('minutes, billable, client_id, user_id')
    .gte('started_at', `${monthStart}T00:00:00+05:30`)
    .lte('started_at', `${monthEnd}T23:59:59+05:30`)
    .not('minutes', 'is', null)
    .limit(2000);

  const byClient = new Map<string, { all: number; billable: number }>();
  let mine = 0;
  for (const e of time ?? []) {
    const key = of(e.client_id);
    const row = byClient.get(key) ?? { all: 0, billable: 0 };
    row.all += e.minutes ?? 0;
    if (e.billable) row.billable += e.minutes ?? 0;
    byClient.set(key, row);
    if (e.user_id === ctx.user.id) mine += e.minutes ?? 0;
  }
  const hrs = (m: number) => (m / 60).toFixed(1);

  parts.push(
    section(
      `Hours logged this month (${month})`,
      [
        `- yours: ${hrs(mine)}h`,
        ...[...byClient.entries()].map(
          ([name, r]) => `- ${name}: ${hrs(r.all)}h total, ${hrs(r.billable)}h billable`,
        ),
      ],
    ),
  );

  // --- Leave ---------------------------------------------------------------
  const { data: leave } = await ctx.supabase
    .from('leave_requests')
    .select('leave_type, from_date, to_date, days, status, user_id')
    .gte('to_date', today)
    .in('status', ['pending', 'approved'])
    .order('from_date')
    .limit(40);

  parts.push(
    section(
      'Leave from today onwards',
      (leave ?? []).map(
        (l) =>
          `- ${l.user_id === ctx.user.id ? 'you' : 'a team member'}: ${l.leave_type}, ${l.from_date} to ${l.to_date} (${l.days}d), ${l.status}`,
      ),
    ),
  );

  // --- Billing (managers and above; RLS agrees) ----------------------------
  if (ctx.isManager) {
    const { data: invoices } = await ctx.supabase
      .from('invoices')
      .select('number, status, issue_date, due_date, total, client_id')
      .in('status', ['draft', 'issued', 'partly_paid'])
      .order('issue_date', { nullsFirst: false })
      .limit(60);

    parts.push(
      section(
        'Invoices not fully paid',
        (invoices ?? []).map(
          (i) =>
            `- ${i.number ?? 'DRAFT'} ${of(i.client_id)} ${formatINR(i.total)} ${i.status}` +
            (i.due_date ? `, due ${i.due_date}${i.due_date < today && i.status !== 'draft' ? ' (OVERDUE)' : ''}` : ''),
        ),
      ),
    );

    const { data: margins } = await ctx.supabase.rpc('client_profitability', {
      agency: ctx.agencyId,
      from_date: monthStart,
      to_date: monthEnd,
    });

    parts.push(
      section(
        `Client margins this month (${month})`,
        ((margins ?? []) as ClientMargin[]).map(
          (m) =>
            `- ${m.client_name}: revenue ${formatINR(m.revenue)}, cost ${formatINR(m.total_cost)}, margin ${formatINR(m.margin)}` +
            (m.margin_pct === null ? '' : ` (${Number(m.margin_pct).toFixed(0)}%)`) +
            (Number(m.unpriced_hours) > 0 ? `, ${Number(m.unpriced_hours).toFixed(1)}h costed at zero` : ''),
        ),
      ),
    );
  } else {
    parts.push('## Billing and margins\nnot visible to your role');
  }

  return parts.join('\n\n');
}
