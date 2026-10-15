-- =============================================================================
-- Flauntix Platform — Phase 3, part 2: automated client reports
--
-- A monthly report per client, assembled from what the platform already knows:
-- what went live, what is coming, what is waiting on the client, how many
-- revision rounds it took.
--
-- The numbers are SNAPSHOTTED into `snapshot` jsonb when the report is built,
-- and frozen when it is sent. A report is a statement of what you told the
-- client in September; recomputing it live would quietly rewrite history the
-- moment a post got rescheduled. Same reasoning as the invoice snapshots.
--
-- Deliberately excludes hours, cost rates and margins. Those are internal and
-- live in /profitability; a client-facing document that carries them is one
-- misconfigured policy away from an embarrassing leak.
-- Idempotent. Requires 0001–0006.
-- =============================================================================

do $$ begin create type report_status as enum ('draft','sent');
exception when duplicate_object then null; end $$;

create table if not exists public.client_reports (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references public.agencies(id) on delete cascade,
  client_id    uuid not null references public.clients(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  title        text not null check (char_length(title) between 1 and 200),
  status       report_status not null default 'draft',
  /** Frozen on send. Client-facing figures only — never hours or costs. */
  snapshot     jsonb not null default '{}'::jsonb,
  /** The account manager's own words; the numbers alone are not a report. */
  summary      text,
  next_steps   text,
  built_at     timestamptz,
  sent_at      timestamptz,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint client_reports_period check (period_end >= period_start),
  constraint client_reports_sent_has_time check (
    (status = 'draft' and sent_at is null) or (status = 'sent' and sent_at is not null)
  )
);

create index if not exists client_reports_agency_idx on public.client_reports (agency_id, period_start desc);
create index if not exists client_reports_client_idx on public.client_reports (client_id, period_start desc);

drop trigger if exists touch_client_reports on public.client_reports;
create trigger touch_client_reports before update on public.client_reports
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- build
/**
 * Assembles the report's figures from live data and stores them in `snapshot`.
 * Refuses once the report is sent, so a sent report can never change.
 */
create or replace function public.build_client_report(report_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rep client_reports%rowtype;
  snap jsonb;
begin
  select * into rep from client_reports where id = report_id;
  if not found then raise exception 'Report not found'; end if;
  if not public.is_staff(rep.agency_id) then raise exception 'Not allowed'; end if;
  if rep.status = 'sent' then raise exception 'This report has been sent and cannot be rebuilt'; end if;

  select jsonb_build_object(
    'published', coalesce((
      select jsonb_agg(jsonb_build_object(
               'title', ci.title, 'platforms', ci.platforms, 'format', ci.format,
               'date', ci.scheduled_date, 'url', ci.published_url)
             order by ci.scheduled_date)
        from content_items ci
       where ci.client_id = rep.client_id
         and ci.status = 'published'
         and ci.scheduled_date between rep.period_start and rep.period_end
    ), '[]'::jsonb),
    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object(
               'title', ci.title, 'platforms', ci.platforms, 'format', ci.format,
               'date', ci.scheduled_date)
             order by ci.scheduled_date)
        from content_items ci
       where ci.client_id = rep.client_id
         and ci.status in ('approved','scheduled')
         and ci.scheduled_date > rep.period_end
    ), '[]'::jsonb),
    'awaiting_you', coalesce((
      select jsonb_agg(jsonb_build_object(
               'title', ci.title, 'date', ci.scheduled_date, 'since', a.requested_at)
             order by a.requested_at)
        from content_items ci
        join content_approvals a on a.content_item_id = ci.id and a.decision = 'pending'
       where ci.client_id = rep.client_id
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'published', (select count(*) from content_items ci
                     where ci.client_id = rep.client_id and ci.status = 'published'
                       and ci.scheduled_date between rep.period_start and rep.period_end),
      'tasks_done', (select count(*) from tasks t
                      where t.client_id = rep.client_id and t.status = 'done'
                        and (t.completed_at at time zone 'Asia/Kolkata')::date
                            between rep.period_start and rep.period_end),
      'approval_rounds', (select count(*) from content_approvals a
                           join content_items ci on ci.id = a.content_item_id
                          where ci.client_id = rep.client_id
                            and a.decided_at is not null
                            and (a.decided_at at time zone 'Asia/Kolkata')::date
                                between rep.period_start and rep.period_end),
      'changes_requested', (select count(*) from content_approvals a
                             join content_items ci on ci.id = a.content_item_id
                            where ci.client_id = rep.client_id
                              and a.decision = 'changes_requested'
                              and (a.decided_at at time zone 'Asia/Kolkata')::date
                                  between rep.period_start and rep.period_end)
    ),
    -- Only spend the client is already party to, because it was rebilled.
    'ad_spend', coalesce((
      select sum(e.amount) from expenses e
       where e.client_id = rep.client_id and e.rebilled
         and e.incurred_on between rep.period_start and rep.period_end
    ), 0),
    'built_at', now()
  ) into snap;

  update client_reports set snapshot = snap, built_at = now() where id = report_id;
  return snap;
end $$;

/** Freezes the report and makes it visible in the client portal. */
create or replace function public.send_client_report(report_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare rep client_reports%rowtype;
begin
  select * into rep from client_reports where id = report_id;
  if not found then raise exception 'Report not found'; end if;
  if not public.is_manager(rep.agency_id) then raise exception 'Not allowed'; end if;
  if rep.status = 'sent' then raise exception 'Already sent'; end if;
  if rep.built_at is null then raise exception 'Build the report before sending it'; end if;

  update client_reports set status = 'sent', sent_at = now() where id = report_id;

  insert into activity_log (agency_id, actor_id, entity_type, entity_id, action, meta)
  values (rep.agency_id, (select id from profiles where id = auth.uid()), 'report', report_id, 'sent',
          jsonb_build_object('title', rep.title));
end $$;

grant execute on function public.build_client_report(uuid) to authenticated;
grant execute on function public.send_client_report(uuid) to authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.client_reports enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'client_reports' loop
    execute format('drop policy if exists %I on public.client_reports', r.policyname);
  end loop;
end $$;

create policy reports_select on public.client_reports for select using (public.is_staff(agency_id));
create policy reports_insert on public.client_reports for insert with check (public.is_staff(agency_id));
-- A sent report is immutable; the RPCs are definer and handle the transition.
create policy reports_update on public.client_reports for update
  using (public.is_staff(agency_id) and status = 'draft')
  with check (public.is_staff(agency_id));
create policy reports_delete on public.client_reports for delete
  using (public.is_manager(agency_id) and status = 'draft');

-- ---------------------------------------------------------------- portal
-- Sent reports only, for the caller's own clients, exposing just the columns a
-- client should see. Same security-barrier pattern as the other portal views.
create or replace view public.portal_reports with (security_barrier = true) as
select r.id,
       r.client_id,
       cl.name as client_name,
       r.title,
       r.period_start,
       r.period_end,
       r.summary,
       r.next_steps,
       r.snapshot,
       r.sent_at
  from public.client_reports r
  join public.clients cl on cl.id = r.client_id
 where r.status = 'sent'
   and r.client_id in (select public.portal_client_ids());

grant select on public.portal_reports to authenticated;
