-- =============================================================================
-- Flauntix Platform — Phase 3, part 4: HR / leave
--
-- Leave requests, approvals and balances, plus a team calendar.
--
-- The control that matters: NOBODY APPROVES THEIR OWN LEAVE, including an
-- owner. `decide_leave()` refuses it outright rather than relying on the UI to
-- hide the button.
-- Idempotent. Requires 0001–0008.
-- =============================================================================

do $$ begin create type leave_status as enum ('pending','approved','rejected','cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  leave_type    text not null default 'Casual',
  from_date     date not null,
  to_date       date not null,
  /** Working days claimed. Separate from the span so half days and weekends work. */
  days          numeric(4,1) not null check (days > 0),
  reason        text,
  status        leave_status not null default 'pending',
  decided_by    uuid references public.profiles(id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint leave_dates check (to_date >= from_date),
  constraint leave_days_fit check (days <= (to_date - from_date) + 1),
  constraint leave_decided check (
    (status in ('pending','cancelled') and decided_at is null)
    or (status in ('approved','rejected') and decided_at is not null)
  )
);

-- Days granted per person per financial year, per type.
create table if not exists public.leave_allowances (
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  fy         text not null,
  leave_type text not null,
  days       numeric(5,1) not null default 0 check (days >= 0),
  updated_at timestamptz not null default now(),
  primary key (agency_id, user_id, fy, leave_type)
);

create index if not exists leave_requests_agency_idx on public.leave_requests (agency_id, from_date desc);
create index if not exists leave_requests_user_idx   on public.leave_requests (user_id, from_date desc);

drop trigger if exists touch_leave_requests on public.leave_requests;
create trigger touch_leave_requests before update on public.leave_requests
  for each row execute function public.touch_updated_at();

/**
 * Files a leave request for the caller.
 * Refuses a request that overlaps one already pending or approved, so the
 * balance cannot be double-counted by someone submitting twice.
 */
create or replace function public.request_leave(
  l_type text,
  from_d date,
  to_d date,
  n_days numeric,
  l_reason text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  my_agency uuid;
  new_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if to_d < from_d then raise exception 'The end date is before the start date'; end if;
  if n_days is null or n_days <= 0 then raise exception 'Enter how many days you are taking'; end if;
  if n_days > (to_d - from_d) + 1 then raise exception 'That is more days than the dates cover'; end if;

  select m.agency_id into my_agency
    from memberships m
   where m.user_id = auth.uid() and m.active
   order by m.created_at
   limit 1;
  if my_agency is null then raise exception 'Not a member of any agency'; end if;

  if exists (
    select 1 from leave_requests r
     where r.user_id = auth.uid()
       and r.status in ('pending','approved')
       and r.from_date <= to_d and r.to_date >= from_d
  ) then
    raise exception 'You already have leave requested or approved that overlaps those dates';
  end if;

  insert into leave_requests (agency_id, user_id, leave_type, from_date, to_date, days, reason)
  values (my_agency, auth.uid(), l_type, from_d, to_d, n_days, l_reason)
  returning id into new_id;

  insert into activity_log (agency_id, actor_id, entity_type, entity_id, action, meta)
  values (my_agency, auth.uid(), 'leave', new_id, 'requested',
          jsonb_build_object('type', l_type, 'from', from_d, 'to', to_d, 'days', n_days));
  return new_id;
end $$;

/** Approves or rejects. Nobody may decide their own request, owners included. */
create or replace function public.decide_leave(
  request_id uuid,
  decision leave_status,
  note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare req leave_requests%rowtype;
begin
  if decision not in ('approved','rejected') then raise exception 'Choose approved or rejected'; end if;

  select * into req from leave_requests where id = request_id;
  if not found then raise exception 'Request not found'; end if;
  if not public.is_manager(req.agency_id) then raise exception 'Not allowed'; end if;
  if req.user_id = auth.uid() then raise exception 'You cannot decide your own leave request'; end if;
  if req.status <> 'pending' then raise exception 'This request has already been decided'; end if;

  update leave_requests
     set status = decision, decided_by = auth.uid(), decided_at = now(), decision_note = note
   where id = request_id;

  insert into activity_log (agency_id, actor_id, entity_type, entity_id, action, meta)
  values (req.agency_id, auth.uid(), 'leave', request_id,
          case when decision = 'approved' then 'approved' else 'rejected' end,
          jsonb_build_object('for', req.user_id, 'days', req.days));
end $$;

/** Withdraws your own request, or a manager cancels somebody's approved leave. */
create or replace function public.cancel_leave(request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare req leave_requests%rowtype;
begin
  select * into req from leave_requests where id = request_id;
  if not found then raise exception 'Request not found'; end if;
  if req.user_id <> auth.uid() and not public.is_manager(req.agency_id) then
    raise exception 'Not allowed';
  end if;
  if req.status = 'cancelled' then raise exception 'Already cancelled'; end if;

  update leave_requests
     set status = 'cancelled', decided_at = null, decided_by = null
   where id = request_id;
end $$;

/** Allowance, taken and remaining per person per type for a financial year. */
create or replace function public.leave_balances(agency uuid, the_fy text)
returns table (
  user_id uuid, full_name text, leave_type text,
  allowance numeric, taken numeric, pending numeric, remaining numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager(agency) then raise exception 'Not allowed'; end if;

  return query
  with mine as (
    select m.user_id, p.full_name from memberships m
      join profiles p on p.id = m.user_id
     where m.agency_id = agency and m.active
  ),
  -- t.leave_type, not a bare leave_type: plpgsql keeps this function's
  -- RETURNS TABLE column names in scope for the whole body, so an unqualified
  -- reference is ambiguous against the output column of the same name.
  types as (
    select distinct t.leave_type from (
      select a.leave_type from leave_allowances a where a.agency_id = agency and a.fy = the_fy
      union
      select r.leave_type from leave_requests r
       where r.agency_id = agency and public.fy_of(r.from_date) = the_fy
    ) t
  ),
  grid as (select mine.user_id, mine.full_name, types.leave_type from mine cross join types)
  select g.user_id, g.full_name, g.leave_type,
         coalesce(al.days, 0),
         coalesce(tk.days, 0),
         coalesce(pd.days, 0),
         coalesce(al.days, 0) - coalesce(tk.days, 0)
    from grid g
    left join leave_allowances al
      on al.agency_id = agency and al.user_id = g.user_id and al.fy = the_fy and al.leave_type = g.leave_type
    left join (
      select r.user_id, r.leave_type, sum(r.days) as days from leave_requests r
       where r.agency_id = agency and r.status = 'approved' and public.fy_of(r.from_date) = the_fy
       group by 1, 2
    ) tk on tk.user_id = g.user_id and tk.leave_type = g.leave_type
    left join (
      select r.user_id, r.leave_type, sum(r.days) as days from leave_requests r
       where r.agency_id = agency and r.status = 'pending' and public.fy_of(r.from_date) = the_fy
       group by 1, 2
    ) pd on pd.user_id = g.user_id and pd.leave_type = g.leave_type
   order by 2, 3;
end $$;

create or replace function public.set_leave_allowance(
  member uuid, the_fy text, l_type text, n_days numeric
) returns void
language plpgsql security definer set search_path = public as $$
declare target_agency uuid;
begin
  if n_days is null or n_days < 0 then raise exception 'Days cannot be negative'; end if;

  select m.agency_id into target_agency
    from memberships m
   where m.user_id = member and public.is_manager(m.agency_id)
   limit 1;
  if target_agency is null then raise exception 'Not allowed'; end if;

  insert into leave_allowances (agency_id, user_id, fy, leave_type, days)
  values (target_agency, member, the_fy, l_type, n_days)
  on conflict (agency_id, user_id, fy, leave_type)
    do update set days = excluded.days, updated_at = now();
end $$;

grant execute on function public.request_leave(text, date, date, numeric, text) to authenticated;
grant execute on function public.decide_leave(uuid, leave_status, text) to authenticated;
grant execute on function public.cancel_leave(uuid) to authenticated;
grant execute on function public.leave_balances(uuid, text) to authenticated;
grant execute on function public.set_leave_allowance(uuid, text, text, numeric) to authenticated;

alter table public.leave_requests   enable row level security;
alter table public.leave_allowances enable row level security;

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('leave_requests','leave_allowances') loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Everyone sees who is off, because that is what a team calendar is for; the
-- reason is the only private part, and the app does not show it to peers.
create policy leave_select on public.leave_requests for select using (public.is_member(agency_id));
-- Writes go through the RPCs, which enforce the overlap and self-approval rules.
create policy leave_delete on public.leave_requests for delete
  using (public.is_manager(agency_id));

create policy allowances_select on public.leave_allowances for select
  using (user_id = auth.uid() or public.is_manager(agency_id));
