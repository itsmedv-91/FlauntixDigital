-- =============================================================================
-- Flauntix Platform — Phase 3, part 1: profitability
--
-- Answers "which clients actually make us money" from data the platform already
-- holds: time at each person's cost rate, invoices, and a new expenses table for
-- pass-through costs (ad spend fronted for a client, freelancers, tools).
--
-- Two decisions worth knowing about, both of which change the numbers:
--
--  1. COST RATES ARE SNAPSHOTTED ONTO THE TIME ENTRY. Joining live to
--     `memberships.hourly_cost` would silently rewrite every past month's margin
--     the day somebody gets a raise. `time_entries.cost_rate` is stamped on
--     insert by a trigger (so it holds however the row was written) and existing
--     rows are backfilled from the current rate once, below.
--
--  2. NON-BILLABLE CLIENT TIME IS STILL A COST. The `billable` flag decides
--     whether you *could* invoice the hour, not whether it cost you. A client
--     that eats forty hours of unbillable rework is unprofitable even though
--     none of it was billed, and that is exactly what this should show.
--
-- Revenue is recognised on the invoice's issue date, and uses `taxable_total`
-- (GST is collected tax, not revenue). Idempotent. Requires 0001–0005.
-- =============================================================================

-- ---------------------------------------------------------------- cost rate
alter table public.time_entries
  add column if not exists cost_rate numeric(10,2);

comment on column public.time_entries.cost_rate is
  'The person''s hourly cost when this entry was logged. Snapshotted so a later '
  'pay change cannot rewrite historic margins.';

create or replace function public.stamp_time_cost_rate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cost_rate is null then
    select m.hourly_cost into new.cost_rate
      from memberships m
     where m.agency_id = new.agency_id and m.user_id = new.user_id;
  end if;
  return new;
end $$;

drop trigger if exists stamp_time_cost_rate on public.time_entries;
create trigger stamp_time_cost_rate before insert on public.time_entries
  for each row execute function public.stamp_time_cost_rate();

-- One-off backfill for time logged before this migration. Only fills nulls, so
-- re-running never overwrites a rate that was already stamped.
update public.time_entries te
   set cost_rate = m.hourly_cost
  from public.memberships m
 where m.agency_id = te.agency_id
   and m.user_id = te.user_id
   and te.cost_rate is null
   and m.hourly_cost is not null;

-- ---------------------------------------------------------------- expenses
-- Costs that are not somebody's time. `rebilled` records that the cost was
-- passed on to the client; it is still counted as a cost, because the matching
-- invoice line counts as revenue and the two net out.
create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  -- Null means an agency overhead cost rather than a client cost.
  client_id   uuid references public.clients(id) on delete set null,
  project_id  uuid references public.projects(id) on delete set null,
  incurred_on date not null default current_date,
  category    text not null default 'Other',
  description text not null check (char_length(description) between 1 and 300),
  amount      numeric(14,2) not null check (amount >= 0),
  vendor      text,
  rebilled    boolean not null default false,
  invoice_id  uuid references public.invoices(id) on delete set null,
  notes       text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists expenses_agency_idx on public.expenses (agency_id, incurred_on);
create index if not exists expenses_client_idx on public.expenses (client_id, incurred_on);

drop trigger if exists touch_expenses on public.expenses;
create trigger touch_expenses before update on public.expenses
  for each row execute function public.touch_updated_at();

alter table public.expenses enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'expenses' loop
    execute format('drop policy if exists %I on public.expenses', r.policyname);
  end loop;
end $$;

-- Costs and margins are managers and above, like invoices and the vault.
create policy expenses_select on public.expenses for select using (public.is_manager(agency_id));
create policy expenses_write  on public.expenses for all
  using (public.is_manager(agency_id)) with check (public.is_manager(agency_id));

-- ---------------------------------------------------------------- reporting
/**
 * Per-client margin for a date range.
 *
 * Hours and labour cost come from when the work was logged (started_at, in IST);
 * revenue comes from invoices issued in the range. Those two can disagree at a
 * month boundary — April's work invoiced in May lands in May — which is the
 * normal accrual-vs-invoice-date gap, not a bug. Quarter and year views wash it
 * out; `expected_retainer` is there to make a month's gap obvious.
 */
create or replace function public.client_profitability(
  agency uuid,
  from_date date,
  to_date date
)
returns table (
  client_id         uuid,
  client_name       text,
  client_status     client_status,
  revenue           numeric,
  expected_retainer numeric,
  labour_cost       numeric,
  expense_cost      numeric,
  rebilled_expense  numeric,
  total_cost        numeric,
  margin            numeric,
  margin_pct        numeric,
  hours             numeric,
  billable_hours    numeric,
  effective_rate    numeric,
  unpriced_hours    numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  months integer;
begin
  if not public.is_manager(agency) then raise exception 'Not allowed'; end if;
  if to_date < from_date then raise exception 'The end date is before the start date'; end if;

  -- Whole calendar months the range touches, for the retainer comparison.
  select count(*)::integer into months
    from generate_series(date_trunc('month', from_date), date_trunc('month', to_date), interval '1 month');

  return query
  with inv as (
    select i.client_id, sum(i.taxable_total) as revenue
      from invoices i
     where i.agency_id = agency
       and i.status not in ('draft', 'cancelled')
       and i.issue_date between from_date and to_date
     group by i.client_id
  ),
  tim as (
    select t.client_id,
           sum(coalesce(t.minutes, 0)) / 60.0 as hours,
           sum(case when t.billable then coalesce(t.minutes, 0) else 0 end) / 60.0 as billable_hours,
           sum(coalesce(t.minutes, 0) / 60.0 * coalesce(t.cost_rate, 0)) as labour_cost,
           -- Hours logged by somebody with no cost rate set: counted as free,
           -- which the UI has to warn about rather than quietly absorb.
           sum(case when t.cost_rate is null then coalesce(t.minutes, 0) else 0 end) / 60.0 as unpriced_hours
      from time_entries t
     where t.agency_id = agency
       and t.client_id is not null
       and (t.started_at at time zone 'Asia/Kolkata')::date between from_date and to_date
     group by t.client_id
  ),
  exp as (
    select e.client_id,
           sum(e.amount) as expense_cost,
           sum(case when e.rebilled then e.amount else 0 end) as rebilled_expense
      from expenses e
     where e.agency_id = agency
       and e.client_id is not null
       and e.incurred_on between from_date and to_date
     group by e.client_id
  )
  select c.id,
         c.name,
         c.status,
         round(coalesce(inv.revenue, 0), 2),
         round(coalesce(c.monthly_retainer, 0) * months, 2),
         round(coalesce(tim.labour_cost, 0), 2),
         round(coalesce(exp.expense_cost, 0), 2),
         round(coalesce(exp.rebilled_expense, 0), 2),
         round(coalesce(tim.labour_cost, 0) + coalesce(exp.expense_cost, 0), 2),
         round(coalesce(inv.revenue, 0) - coalesce(tim.labour_cost, 0) - coalesce(exp.expense_cost, 0), 2),
         case when coalesce(inv.revenue, 0) > 0
              then round((coalesce(inv.revenue, 0) - coalesce(tim.labour_cost, 0) - coalesce(exp.expense_cost, 0))
                         / inv.revenue * 100, 1)
         end,
         round(coalesce(tim.hours, 0), 2),
         round(coalesce(tim.billable_hours, 0), 2),
         case when coalesce(tim.hours, 0) > 0
              then round(coalesce(inv.revenue, 0) / tim.hours, 2)
         end,
         round(coalesce(tim.unpriced_hours, 0), 2)
    from clients c
    left join inv on inv.client_id = c.id
    left join tim on tim.client_id = c.id
    left join exp on exp.client_id = c.id
   where c.agency_id = agency
     and (inv.client_id is not null or tim.client_id is not null or exp.client_id is not null
          or coalesce(c.monthly_retainer, 0) > 0)
   order by 11 desc nulls last;
end $$;

/**
 * The agency's own bottom line for the same range: client revenue less the cost
 * of serving those clients, less overhead (time and expenses with no client).
 */
create or replace function public.agency_profitability(
  agency uuid,
  from_date date,
  to_date date
)
returns table (
  revenue         numeric,
  direct_cost     numeric,
  overhead_cost   numeric,
  overhead_hours  numeric,
  margin          numeric,
  margin_pct      numeric,
  client_hours    numeric,
  unpriced_hours  numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager(agency) then raise exception 'Not allowed'; end if;

  return query
  with rev as (
    select coalesce(sum(i.taxable_total), 0) as revenue
      from invoices i
     where i.agency_id = agency
       and i.status not in ('draft', 'cancelled')
       and i.issue_date between from_date and to_date
  ),
  tim as (
    select
      coalesce(sum(case when t.client_id is not null
                        then coalesce(t.minutes, 0) / 60.0 * coalesce(t.cost_rate, 0) else 0 end), 0) as direct_labour,
      coalesce(sum(case when t.client_id is null
                        then coalesce(t.minutes, 0) / 60.0 * coalesce(t.cost_rate, 0) else 0 end), 0) as overhead_labour,
      coalesce(sum(case when t.client_id is null then coalesce(t.minutes, 0) else 0 end), 0) / 60.0 as overhead_hours,
      coalesce(sum(case when t.client_id is not null then coalesce(t.minutes, 0) else 0 end), 0) / 60.0 as client_hours,
      coalesce(sum(case when t.cost_rate is null then coalesce(t.minutes, 0) else 0 end), 0) / 60.0 as unpriced_hours
      from time_entries t
     where t.agency_id = agency
       and (t.started_at at time zone 'Asia/Kolkata')::date between from_date and to_date
  ),
  exp as (
    select
      coalesce(sum(case when e.client_id is not null then e.amount else 0 end), 0) as direct_expense,
      coalesce(sum(case when e.client_id is null then e.amount else 0 end), 0) as overhead_expense
      from expenses e
     where e.agency_id = agency
       and e.incurred_on between from_date and to_date
  )
  select round(rev.revenue, 2),
         round(tim.direct_labour + exp.direct_expense, 2),
         round(tim.overhead_labour + exp.overhead_expense, 2),
         round(tim.overhead_hours, 2),
         round(rev.revenue - tim.direct_labour - exp.direct_expense
                           - tim.overhead_labour - exp.overhead_expense, 2),
         case when rev.revenue > 0
              then round((rev.revenue - tim.direct_labour - exp.direct_expense
                                      - tim.overhead_labour - exp.overhead_expense) / rev.revenue * 100, 1)
         end,
         round(tim.client_hours, 2),
         round(tim.unpriced_hours, 2)
    from rev, tim, exp;
end $$;

/** Who logged time in the range with no cost rate, so the warning can name them. */
create or replace function public.unpriced_contributors(
  agency uuid,
  from_date date,
  to_date date
)
returns table (user_id uuid, full_name text, email text, hours numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager(agency) then raise exception 'Not allowed'; end if;

  return query
  select p.id, p.full_name, p.email, round(sum(coalesce(t.minutes, 0)) / 60.0, 2)
    from time_entries t
    join profiles p on p.id = t.user_id
   where t.agency_id = agency
     and t.cost_rate is null
     and coalesce(t.minutes, 0) > 0
     and (t.started_at at time zone 'Asia/Kolkata')::date between from_date and to_date
   group by p.id, p.full_name, p.email
   order by 4 desc;
end $$;

/**
 * Sets one member's hourly cost, and nothing else.
 *
 * Needed because `memberships_update` is admin-only and refuses rows where
 * `role = 'owner'` or the row is your own — sensible for role changes, but it
 * means the owner's cost rate could never be set, and the owner is usually the
 * most expensive person in the agency. Their time would then be costed at zero
 * and every margin would be wrong.
 *
 * Narrow by construction: it updates `hourly_cost` only, so it cannot be used
 * to change anybody's role or reactivate a membership.
 */
create or replace function public.set_hourly_cost(member uuid, cost numeric)
returns void
language plpgsql security definer set search_path = public as $$
declare
  target_agency uuid;
begin
  if cost is not null and cost < 0 then raise exception 'An hourly cost cannot be negative'; end if;

  select m.agency_id into target_agency
    from memberships m
   where m.user_id = member
     and public.is_manager(m.agency_id)
   limit 1;
  if target_agency is null then raise exception 'Not allowed'; end if;

  update memberships set hourly_cost = cost
   where agency_id = target_agency and user_id = member;

  insert into activity_log (agency_id, actor_id, entity_type, entity_id, action, meta)
  values (target_agency, (select id from profiles where id = auth.uid()), 'member', member,
          'hourly_cost_set', jsonb_build_object('hourly_cost', cost));
end $$;

grant execute on function public.set_hourly_cost(uuid, numeric) to authenticated;
grant execute on function public.client_profitability(uuid, date, date) to authenticated;
grant execute on function public.agency_profitability(uuid, date, date) to authenticated;
grant execute on function public.unpriced_contributors(uuid, date, date) to authenticated;
