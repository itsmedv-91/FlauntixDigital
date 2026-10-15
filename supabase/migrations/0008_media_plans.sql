-- =============================================================================
-- Flauntix Platform — Phase 3, part 3: media planning
--
-- Plan a client's paid budget by channel and month, then compare it against
-- what was actually spent. Actuals come from `expenses` rows categorised as ad
-- spend, which is why this migration adds `expenses.channel`: without it there
-- is no way to tell a Meta rupee from a Google one.
-- Idempotent. Requires 0001–0007.
-- =============================================================================

do $$ begin create type media_plan_status as enum ('draft','shared','active','closed');
exception when duplicate_object then null; end $$;

-- Lets an ad-spend expense be attributed to the channel it was spent on.
alter table public.expenses add column if not exists channel text;

create table if not exists public.media_plans (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references public.agencies(id) on delete cascade,
  client_id    uuid not null references public.clients(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 200),
  period_start date not null,
  period_end   date not null,
  status       media_plan_status not null default 'draft',
  objective    text,
  notes        text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint media_plans_period check (period_end >= period_start)
);

create table if not exists public.media_plan_lines (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  plan_id     uuid not null references public.media_plans(id) on delete cascade,
  channel     text not null check (char_length(channel) between 1 and 60),
  /** Always the first of the month the budget is planned for. */
  month       date not null,
  planned     numeric(14,2) not null default 0 check (planned >= 0),
  objective   text,
  notes       text,
  created_at  timestamptz not null default now(),
  unique (plan_id, channel, month)
);

create index if not exists media_plans_agency_idx on public.media_plans (agency_id, period_start desc);
create index if not exists media_plans_client_idx on public.media_plans (client_id, period_start desc);
create index if not exists media_plan_lines_idx   on public.media_plan_lines (plan_id, month);
create index if not exists expenses_channel_idx   on public.expenses (client_id, channel, incurred_on);

drop trigger if exists touch_media_plans on public.media_plans;
create trigger touch_media_plans before update on public.media_plans
  for each row execute function public.touch_updated_at();

-- Normalise the month to its first day, so a line entered as the 15th still
-- matches the actuals for that month.
create or replace function public.normalise_plan_month() returns trigger
language plpgsql as $$
begin
  new.month := date_trunc('month', new.month)::date;
  return new;
end $$;

drop trigger if exists normalise_plan_month on public.media_plan_lines;
create trigger normalise_plan_month before insert or update of month on public.media_plan_lines
  for each row execute function public.normalise_plan_month();

/**
 * Planned against actual, per channel per month.
 *
 * Actuals are ad-spend expenses for the plan's client whose `channel` matches.
 * A channel spent on but never planned still appears, with planned = 0 — the
 * overspend you did not budget for is the thing worth seeing.
 */
create or replace function public.media_plan_summary(plan uuid)
returns table (channel text, month date, planned numeric, actual numeric, variance numeric)
language plpgsql stable security definer set search_path = public as $$
declare p media_plans%rowtype;
begin
  select * into p from media_plans where id = plan;
  if not found then raise exception 'Plan not found'; end if;
  if not public.is_staff(p.agency_id) then raise exception 'Not allowed'; end if;

  return query
  with planned as (
    select l.channel, l.month, sum(l.planned) as planned
      from media_plan_lines l where l.plan_id = plan group by l.channel, l.month
  ),
  actual as (
    select coalesce(nullif(trim(e.channel), ''), 'Unattributed') as channel,
           date_trunc('month', e.incurred_on)::date as month,
           sum(e.amount) as actual
      from expenses e
     where e.client_id = p.client_id
       and e.category = 'Ad spend'
       and e.incurred_on between p.period_start and p.period_end
     group by 1, 2
  )
  select coalesce(pl.channel, ac.channel),
         coalesce(pl.month, ac.month),
         round(coalesce(pl.planned, 0), 2),
         round(coalesce(ac.actual, 0), 2),
         round(coalesce(ac.actual, 0) - coalesce(pl.planned, 0), 2)
    from planned pl
    full outer join actual ac on ac.channel = pl.channel and ac.month = pl.month
   order by 2, 1;
end $$;

grant execute on function public.media_plan_summary(uuid) to authenticated;

alter table public.media_plans      enable row level security;
alter table public.media_plan_lines enable row level security;

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('media_plans','media_plan_lines') loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Budgets are commercially sensitive but not pay data: staff can see, managers edit.
create policy media_plans_select on public.media_plans for select using (public.is_staff(agency_id));
create policy media_plans_write  on public.media_plans for all
  using (public.is_manager(agency_id)) with check (public.is_manager(agency_id));

create policy media_plan_lines_select on public.media_plan_lines for select using (public.is_staff(agency_id));
create policy media_plan_lines_write  on public.media_plan_lines for all
  using (public.is_manager(agency_id)) with check (public.is_manager(agency_id));
