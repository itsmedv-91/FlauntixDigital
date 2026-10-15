-- =============================================================================
-- Flauntix Platform — Phase 4, part 5: plans and limits (multi-agency SaaS)
--
-- The platform has been multi-tenant since 0001. What was missing to sell it is
-- the part that says what an agency is entitled to, and enforces it.
--
-- WHAT IS HERE: plans, a subscription row per agency, and enforcement that
-- actually bites — triggers that refuse the member or client that would take an
-- agency past its plan. UI-only limits are not limits.
--
-- WHAT IS DELIBERATELY NOT HERE: taking money. That needs a Razorpay or Stripe
-- account, a webhook secret and a verified business — none of which can be
-- created from inside a repository. The shape it would take is written down at
-- the bottom of this file so whoever does it is not starting from a blank page.
--
-- THE RULE THAT MAKES THIS SAFE: `agency_subscription` has NO insert, update or
-- delete policy. An agency that could write its own subscription row could give
-- itself the top plan for free. Rows are written by the billing webhook with
-- the service role, or by hand in the SQL editor. `start_trial()` is the single
-- exception, and it can only ever create a trial.
--
-- NO SUBSCRIPTION ROW MEANS UNLIMITED, not "the entry plan". This platform is
-- the agency's own install first and a product second: shipping this migration
-- must not quietly cap an existing six-person agency at three seats. Metering
-- starts when a row exists, and SaaS signup is what creates one.
--
-- Idempotent. Requires 0001.
-- =============================================================================

do $$ begin create type subscription_status as enum
  ('trialing','active','past_due','cancelled');
exception when duplicate_object then null; end $$;

-- Global, not per agency: the catalogue is the product's, not a tenant's.
create table if not exists public.plans (
  code           text primary key,
  name           text not null,
  /** Rupees per month, excluding GST. Null means "talk to us". */
  price_monthly  numeric(10,2),
  /** Null means unlimited, which is why these are nullable rather than huge. */
  max_members    integer check (max_members is null or max_members > 0),
  max_clients    integer check (max_clients is null or max_clients > 0),
  /** Feature switches, read through plan_allows(). */
  features       text[] not null default '{}',
  sort_order     integer not null default 0,
  active         boolean not null default true
);

insert into public.plans (code, name, price_monthly, max_members, max_clients, features, sort_order)
values
  -- The fallback for an agency with no subscription row: everything, unmetered.
  -- `active = false` keeps it out of the upgrade list, which is why that column
  -- is set explicitly below rather than left to its default.
  ('self_hosted', 'Self-hosted', null, null, null,
   array['content','invoicing','portal','assets','profitability','automations','reports','media','influencers','seo','assistant','hr'], 0),
  ('solo',   'Solo',    1499,  3,    5,    array['content','invoicing','portal'], 1),
  ('studio', 'Studio',  3999,  10,   25,   array['content','invoicing','portal','assets','profitability','automations','reports'], 2),
  ('agency', 'Agency',  8999,  30,   null, array['content','invoicing','portal','assets','profitability','automations','reports','media','influencers','seo','assistant','hr'], 3),
  ('scale',  'Scale',   null,  null, null, array['content','invoicing','portal','assets','profitability','automations','reports','media','influencers','seo','assistant','hr'], 4)
on conflict (code) do update set
  name = excluded.name,
  price_monthly = excluded.price_monthly,
  max_members = excluded.max_members,
  max_clients = excluded.max_clients,
  features = excluded.features,
  sort_order = excluded.sort_order;

update public.plans set active = (code <> 'self_hosted');

create table if not exists public.agency_subscription (
  agency_id          uuid primary key references public.agencies(id) on delete cascade,
  plan_code          text not null references public.plans(code),
  status             subscription_status not null default 'trialing',
  trial_ends_on      date,
  current_period_end date,
  /** Seats bought above the plan's allowance, for a one-off arrangement. */
  extra_seats        integer not null default 0 check (extra_seats >= 0),
  /** Whatever the payment provider calls this customer. Null until billed. */
  provider           text,
  provider_ref       text,
  notes              text,
  updated_at         timestamptz not null default now()
);

drop trigger if exists touch_agency_subscription on public.agency_subscription;
create trigger touch_agency_subscription before update on public.agency_subscription
  for each row execute function public.touch_updated_at();

alter table public.plans               enable row level security;
alter table public.agency_subscription enable row level security;

-- The catalogue is public to anyone signed in: the upgrade page has to show it.
drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans for select using (auth.uid() is not null);

-- Your own agency's subscription is readable by its members and NOBODY can
-- write it through the API. See the header.
drop policy if exists agency_subscription_select on public.agency_subscription;
create policy agency_subscription_select on public.agency_subscription
  for select using (public.is_member(agency_id));

/**
 * The plan an agency is actually on.
 *
 * No subscription row means `self_hosted`: unmetered. See the header — this is
 * the agency's own install before it is a product, and a migration that capped
 * a running six-person agency at three seats would be a bug, not a limit.
 *
 * The subscribed plan applies WHATEVER the status. A cancelled subscription
 * does not fall back to unmetered (that would make cancelling an upgrade), and
 * a past-due one does not lock the agency out of its own records over a failed
 * card. Status drives what the plan page says, not what the limits are.
 */
create or replace function public.agency_plan(agency uuid)
returns public.plans
language sql
stable
security definer
set search_path = public
as $$
  select p.* from public.plans p
  where p.code = coalesce(
    (select s.plan_code from public.agency_subscription s where s.agency_id = agency),
    'self_hosted'
  );
$$;

grant execute on function public.agency_plan(uuid) to authenticated;

/** Whether a plan feature is switched on for this agency. */
create or replace function public.plan_allows(agency uuid, feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select feature = any((public.agency_plan(agency)).features);
$$;

grant execute on function public.plan_allows(uuid, text) to authenticated;

/** Seats in use and allowed, for the usage bars on the plan page. */
create or replace function public.plan_usage(agency uuid)
returns table (
  plan_code   text,
  plan_name   text,
  status      text,
  members     integer,
  max_members integer,
  clients     integer,
  max_clients integer,
  trial_ends_on      date,
  current_period_end date
)
language sql
stable
security definer
set search_path = public
as $$
  select p.code, p.name,
         coalesce((select s.status::text from public.agency_subscription s where s.agency_id = agency),
                  'self_hosted'),
         (select count(*)::integer from public.memberships m where m.agency_id = agency and m.active),
         case when p.max_members is null then null
              else p.max_members + coalesce((select s.extra_seats from public.agency_subscription s
                                              where s.agency_id = agency), 0) end,
         (select count(*)::integer from public.clients c
           where c.agency_id = agency and c.status <> 'churned'),
         p.max_clients,
         (select s.trial_ends_on from public.agency_subscription s where s.agency_id = agency),
         (select s.current_period_end from public.agency_subscription s where s.agency_id = agency)
  from public.agency_plan(agency) p
  where public.is_member(agency);
$$;

grant execute on function public.plan_usage(uuid) to authenticated;

/**
 * Refuses the membership that would take an agency past its seat count.
 *
 * A trigger, not a check in the app: the invitation flow, the SQL editor and
 * any future admin tool all have to obey the same limit, and only the database
 * sees all three. Deactivated members do not count, so an agency can swap
 * somebody out without buying a seat.
 */
create or replace function public.enforce_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed integer;
  used    integer;
begin
  if tg_op = 'UPDATE' and (new.active is not true or old.active is true) then
    return new;  -- only an activation can push the count up
  end if;
  if new.active is not true then return new; end if;

  select case when p.max_members is null then null
              else p.max_members + coalesce(s.extra_seats, 0) end
    into allowed
  from public.agency_plan(new.agency_id) p
  left join public.agency_subscription s on s.agency_id = new.agency_id;

  if allowed is null then return new; end if;

  select count(*) into used from public.memberships m
   where m.agency_id = new.agency_id and m.active and m.id <> new.id;

  if used >= allowed then
    raise exception 'Your plan includes % seat(s). Upgrade or deactivate somebody first.', allowed
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists memberships_seat_limit on public.memberships;
create trigger memberships_seat_limit before insert or update on public.memberships
  for each row execute function public.enforce_seat_limit();

/** The same, for clients. Churned clients do not count against the limit. */
create or replace function public.enforce_client_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed integer;
  used    integer;
begin
  if new.status = 'churned' then return new; end if;
  if tg_op = 'UPDATE' and old.status <> 'churned' then return new; end if;

  select p.max_clients into allowed from public.agency_plan(new.agency_id) p;
  if allowed is null then return new; end if;

  select count(*) into used from public.clients c
   where c.agency_id = new.agency_id and c.status <> 'churned' and c.id <> new.id;

  if used >= allowed then
    raise exception 'Your plan includes % client(s). Upgrade to add more.', allowed
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists clients_limit on public.clients;
create trigger clients_limit before insert or update on public.clients
  for each row execute function public.enforce_client_limit();

/**
 * Starts a free trial on a named plan, once.
 *
 * The one write an agency may make to its own subscription, and it is narrow by
 * construction: owners only, status is forced to 'trialing', and it refuses if
 * any row already exists — so it cannot be used to extend a trial, revive a
 * cancelled subscription or move between plans.
 */
create or replace function public.start_trial(agency uuid, plan text, days integer default 14)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.memberships m
    where m.agency_id = agency and m.user_id = auth.uid() and m.active and m.role = 'owner'
  ) then
    raise exception 'Only the agency owner can start a trial';
  end if;
  if exists (select 1 from public.agency_subscription s where s.agency_id = agency) then
    raise exception 'This agency already has a subscription';
  end if;
  if days < 1 or days > 30 then
    raise exception 'A trial runs between 1 and 30 days';
  end if;

  insert into public.agency_subscription (agency_id, plan_code, status, trial_ends_on)
  values (agency, plan, 'trialing',
          (now() at time zone 'Asia/Kolkata')::date + days);
end $$;

revoke all on function public.start_trial(uuid, text, integer) from public, anon;
grant execute on function public.start_trial(uuid, text, integer) to authenticated;

-- =============================================================================
-- Taking money — the part that is NOT built, and what it would take
--
-- Razorpay is the right provider for an Indian agency selling in rupees (UPI,
-- cards and netbanking in one, and it issues the GST-compliant invoice for the
-- subscription itself). It needs a registered business, KYC and a live API key,
-- so it cannot be set up from here. When it is:
--
--   1. Razorpay Subscriptions, one plan per row in `plans`. Keep the plan code
--      as the notes field on the Razorpay plan so the two can be reconciled.
--   2. A webhook route (`/api/billing/webhook`) that verifies the signature with
--      the webhook secret BEFORE reading the body, and is the ONLY thing that
--      writes `agency_subscription`. It needs the Supabase service-role key,
--      which is why no such key exists in the app today.
--   3. Map `subscription.activated` → active, `.pending`/`.halted` → past_due,
--      `.cancelled` → cancelled, and set `current_period_end` from the payload.
--   4. Make the webhook idempotent on Razorpay's event id: webhooks are retried,
--      and a retried upgrade must not extend a period twice.
--
-- Nothing above this comment needs to change for that to be added, which is the
-- point of writing the enforcement into the database now.
-- =============================================================================
