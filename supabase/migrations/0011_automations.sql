-- =============================================================================
-- Flauntix Platform — Phase 4, part 2: automation builder
--
-- "If this, then that" for agency work: an overdue task, content sitting with a
-- client for too long, an invoice past its due date, a contract coming up for
-- renewal — each can post into a chat channel or open a task.
--
-- Three decisions worth knowing before changing anything here:
--
-- 1. THE RULES ARE EVALUATED IN SQL, not by a Node job. One function,
--    `run_automations()`, does every trigger. That keeps the definition of
--    "overdue" identical to the one the rest of the platform uses, and it means
--    the whole thing is testable without a running app.
--
-- 2. IT IS IDEMPOTENT, via `automation_events.dedupe_key` unique per rule. An
--    overdue task is overdue every hour; without the key a nightly run would
--    post the same reminder forever. Running the function twice in a row does
--    nothing the second time, which is what makes a "Run now" button safe.
--
-- 3. ACTIONS ARE A CLOSED SET — post a message, open a task. No webhooks, no
--    arbitrary HTTP. An automation that could call out of the database would be
--    a way to exfiltrate client data with a rule nobody reviewed.
--
-- Scheduling: `run_automations(agency)` is callable by a manager, so the UI has
-- a "Run now" button and the thing works today with no infrastructure. If
-- pg_cron is enabled on the project, the block at the bottom schedules an
-- hourly sweep of every agency as well. It no-ops when pg_cron is absent.
--
-- Idempotent. Requires 0001–0004.
-- =============================================================================

do $$ begin create type automation_trigger as enum (
  'task_overdue', 'content_awaiting_client', 'content_publishing_today',
  'invoice_overdue', 'contract_renewal_soon', 'leave_pending'
); exception when duplicate_object then null; end $$;

do $$ begin create type automation_action as enum ('chat_message', 'create_task');
exception when duplicate_object then null; end $$;

create table if not exists public.automation_rules (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  name        text not null,
  trigger     automation_trigger not null,
  /**
   * Trigger threshold in days. Means "overdue by at least N days" for
   * task_overdue and invoice_overdue, "sitting with the client for N days" for
   * content_awaiting_client, and "within N days" for the two look-aheads.
   */
  threshold_days integer not null default 0 check (threshold_days between 0 and 365),
  /** Limit the rule to one client. Null means every client. */
  client_id   uuid references public.clients(id) on delete cascade,
  action      automation_action not null,
  /** Where a chat_message lands. Required for that action. */
  channel_id  uuid references public.channels(id) on delete cascade,
  /** Who a created task goes to. Null leaves it unassigned. */
  assignee_id uuid references public.profiles(id) on delete set null,
  active      boolean not null default true,
  last_run_at timestamptz,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint automation_needs_channel check (action <> 'chat_message' or channel_id is not null)
);

-- One row per thing a rule has already acted on. The unique key is the whole
-- point: it is what stops a reminder repeating every hour.
create table if not exists public.automation_events (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  rule_id     uuid not null references public.automation_rules(id) on delete cascade,
  dedupe_key  text not null,
  entity_type text not null,
  entity_id   uuid,
  summary     text not null,
  created_at  timestamptz not null default now(),
  unique (rule_id, dedupe_key)
);

create index if not exists automation_rules_agency_idx  on public.automation_rules (agency_id, active);
create index if not exists automation_events_agency_idx on public.automation_events (agency_id, created_at desc);

drop trigger if exists touch_automation_rules on public.automation_rules;
create trigger touch_automation_rules before update on public.automation_rules
  for each row execute function public.touch_updated_at();

alter table public.automation_rules  enable row level security;
alter table public.automation_events enable row level security;

-- Rules are a manager's tool: they create work and post in channels.
drop policy if exists automation_rules_select on public.automation_rules;
create policy automation_rules_select on public.automation_rules
  for select using (public.is_manager(agency_id));
drop policy if exists automation_rules_write on public.automation_rules;
create policy automation_rules_write on public.automation_rules
  for all using (public.is_manager(agency_id)) with check (public.is_manager(agency_id));

-- The log is readable by any staff member: the messages and tasks it produced
-- are visible to them anyway, so hiding where they came from only confuses.
drop policy if exists automation_events_select on public.automation_events;
create policy automation_events_select on public.automation_events
  for select using (public.is_staff(agency_id));

-- No insert/update/delete policy: only run_automations() writes here.

/**
 * The rules themselves. ONE copy, with no caller check, so the "Run now"
 * button and the cron sweep can never drift apart. Not granted to anybody:
 * the two wrappers below decide who may reach it.
 *
 * SECURITY DEFINER because it writes messages and tasks on the agency's behalf
 * and reads rows (invoices) the caller may not be able to read directly.
 *
 * Returns the number of NEW events acted on. Zero on a second run.
 */
create or replace function public.run_automations_core(agency uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r        record;
  hit      record;
  acted    integer := 0;
  today    date := (now() at time zone 'Asia/Kolkata')::date;
  ev_id    uuid;
begin
  for r in select * from public.automation_rules
            where agency_id = agency and active order by created_at loop

    -- Each branch yields the same shape: an entity, a dedupe key and a line of
    -- text. The action code below is written once, not once per trigger.
    for hit in
      select * from (
        -- Tasks past their due date by at least threshold_days.
        select t.id as entity_id, 'task'::text as entity_type, t.client_id,
               'task:' || t.id::text || ':' || (today - t.due_date)::text as dedupe_key,
               'Task "' || t.title || '" is ' || (today - t.due_date) || ' day(s) overdue'
                 as summary
        from public.tasks t
        where r.trigger = 'task_overdue'
          and t.agency_id = agency
          and t.status <> 'done'
          and t.due_date is not null
          and today - t.due_date >= greatest(r.threshold_days, 1)

        union all
        -- Content that has been with the client for too long. The clock is the
        -- open approval round, not the item: a second round restarts it.
        select ci.id, 'content', ci.client_id,
               'approval:' || a.id::text as dedupe_key,
               'Content "' || ci.title || '" has been with the client since '
                 || (a.requested_at at time zone 'Asia/Kolkata')::date
        from public.content_items ci
        join public.content_approvals a
          on a.content_item_id = ci.id and a.decision = 'pending'
        where r.trigger = 'content_awaiting_client'
          and ci.agency_id = agency
          and ci.status = 'client_approval'
          and today - (a.requested_at at time zone 'Asia/Kolkata')::date
              >= greatest(r.threshold_days, 1)

        union all
        -- Content due to go out within threshold_days and not yet published.
        select ci.id, 'content', ci.client_id,
               'publish:' || ci.id::text || ':' || ci.scheduled_date::text as dedupe_key,
               'Content "' || ci.title || '" goes out on ' || ci.scheduled_date
        from public.content_items ci
        where r.trigger = 'content_publishing_today'
          and ci.agency_id = agency
          and ci.status in ('approved', 'scheduled')
          and ci.scheduled_date is not null
          and ci.scheduled_date between today and today + r.threshold_days

        union all
        -- Issued invoices past their due date and not fully paid.
        select i.id, 'invoice', i.client_id,
               'invoice:' || i.id::text || ':' || (today - i.due_date)::text as dedupe_key,
               'Invoice ' || coalesce(i.number, 'draft') || ' is '
                 || (today - i.due_date) || ' day(s) overdue'
        from public.invoices i
        where r.trigger = 'invoice_overdue'
          and i.agency_id = agency
          and i.status in ('issued', 'partly_paid')
          and i.due_date is not null
          and today - i.due_date >= greatest(r.threshold_days, 1)

        union all
        -- Retainers coming up for renewal.
        select c.id, 'client', c.id,
               'renewal:' || c.id::text || ':' || c.contract_end::text as dedupe_key,
               'Contract for ' || c.name || ' ends on ' || c.contract_end
        from public.clients c
        where r.trigger = 'contract_renewal_soon'
          and c.agency_id = agency
          and c.status in ('active', 'onboarding')
          and c.contract_end is not null
          and c.contract_end between today and today + greatest(r.threshold_days, 1)

        union all
        -- Leave requests nobody has decided on.
        select l.id, 'leave', null::uuid,
               'leave:' || l.id::text as dedupe_key,
               'A leave request for ' || l.from_date || ' to ' || l.to_date
                 || ' is still waiting for a decision'
        from public.leave_requests l
        where r.trigger = 'leave_pending'
          and l.agency_id = agency
          and l.status = 'pending'
          and today - l.created_at::date >= r.threshold_days
      ) q
      where r.client_id is null or q.client_id = r.client_id
    loop
      -- The dedupe key decides whether this is new. `on conflict do nothing`
      -- plus `returning` leaves ev_id null when it is not, so the action below
      -- simply does not run.
      insert into public.automation_events
        (agency_id, rule_id, dedupe_key, entity_type, entity_id, summary)
      values (agency, r.id, hit.dedupe_key, hit.entity_type, hit.entity_id, hit.summary)
      on conflict (rule_id, dedupe_key) do nothing
      returning id into ev_id;

      if ev_id is null then continue; end if;
      acted := acted + 1;

      if r.action = 'chat_message' then
        insert into public.messages (agency_id, channel_id, author_id, body)
        values (agency, r.channel_id, null, '🤖 ' || r.name || ': ' || hit.summary);
      elsif r.action = 'create_task' then
        insert into public.tasks
          (agency_id, client_id, title, description, status, priority, assignee_id, due_date)
        values (agency, hit.client_id, hit.summary,
                'Opened automatically by the "' || r.name || '" automation.',
                'todo', 'medium', r.assignee_id, today);
      end if;

      ev_id := null;
    end loop;

    update public.automation_rules set last_run_at = now() where id = r.id;
  end loop;

  return acted;
end $$;

-- Named roles as well as PUBLIC: Supabase's default privileges grant execute on
-- new functions in `public` to anon and authenticated, so revoking from PUBLIC
-- alone would leave this reachable through the API.
revoke all on function public.run_automations_core(uuid) from public, anon, authenticated;

/**
 * What the app calls. The is_manager() check is the whole guard: without it any
 * member could make the database post into a channel as the agency.
 */
create or replace function public.run_automations(agency uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_manager(agency) then
    raise exception 'Only a manager can run automations';
  end if;
  return public.run_automations_core(agency);
end $$;

revoke all on function public.run_automations(uuid) from public, anon;
grant execute on function public.run_automations(uuid) to authenticated;

/**
 * Sweeps every agency. For pg_cron only: there is no caller to authorise, so
 * this is granted to nobody and is unreachable through the API.
 */
create or replace function public.run_all_automations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  a     uuid;
  total integer := 0;
begin
  for a in select distinct agency_id from public.automation_rules where active loop
    total := total + public.run_automations_core(a);
  end loop;
  return total;
end $$;

revoke all on function public.run_all_automations() from public, anon, authenticated;

-- Hourly sweep, if pg_cron is available. Enable it in Supabase → Database →
-- Extensions; without it the "Run now" button is the only trigger.
do $$ begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'pg_cron not installed — automations run only from the UI button';
    return;
  end if;
  perform cron.unschedule('flauntix_automations')
    where exists (select 1 from cron.job where jobname = 'flauntix_automations');
  perform cron.schedule('flauntix_automations', '7 * * * *',
                        'select public.run_all_automations()');
end $$;
