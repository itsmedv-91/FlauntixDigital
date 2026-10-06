-- =============================================================================
-- Flauntix Platform — Phase 2, part 1: content calendar + client approvals
-- Adds content_items (the calendar), content_approvals (the approval trail)
-- and content_comments (feedback, internal or client-visible).
-- Idempotent: safe to re-run. Requires 0001_foundation.sql.
-- =============================================================================

-- ---------------------------------------------------------------- enums
do $$ begin create type content_status as enum
  ('idea','in_progress','internal_review','client_approval','changes_requested','approved','scheduled','published','archived');
exception when duplicate_object then null; end $$;

do $$ begin create type content_format as enum
  ('static','carousel','reel','story','video','blog','email','ad','other');
exception when duplicate_object then null; end $$;

do $$ begin create type approval_decision as enum ('pending','approved','changes_requested');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tables
-- One row per planned piece of content. scheduled_date is a plain date (and
-- scheduled_time a plain time) so the calendar grid is unambiguous in IST
-- without any timezone arithmetic.
create table if not exists public.content_items (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  client_id      uuid not null references public.clients(id) on delete cascade,
  project_id     uuid references public.projects(id) on delete set null,
  task_id        uuid references public.tasks(id) on delete set null,
  title          text not null check (char_length(title) between 1 and 200),
  caption        text,
  hashtags       text[] not null default '{}',
  platforms      text[] not null default '{}',
  format         content_format not null default 'static',
  status         content_status not null default 'idea',
  scheduled_date date,
  scheduled_time time,
  assignee_id    uuid references public.profiles(id) on delete set null,
  asset_urls     text[] not null default '{}',
  published_url  text,
  published_at   timestamptz,
  notes          text,
  revision_count integer not null default 0,
  max_revisions  integer,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Each round of "sent to the client" is one row, so the history of who
-- approved what, and when, survives later edits.
create table if not exists public.content_approvals (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references public.agencies(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  round           integer not null default 1,
  decision        approval_decision not null default 'pending',
  requested_by    uuid references public.profiles(id) on delete set null,
  requested_at    timestamptz not null default now(),
  -- Decided either by a client contact (through the portal, later) or by a
  -- team member recording a decision the client gave over WhatsApp or email.
  decided_by_contact_id uuid references public.client_contacts(id) on delete set null,
  decided_by_profile_id uuid references public.profiles(id) on delete set null,
  on_behalf       boolean not null default false,
  decided_at      timestamptz,
  comment         text,
  created_at      timestamptz not null default now(),
  constraint content_approvals_decided_check check (
    (decision = 'pending' and decided_at is null)
    or (decision <> 'pending' and decided_at is not null)
  )
);

create table if not exists public.content_comments (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null references public.agencies(id) on delete cascade,
  content_item_id   uuid not null references public.content_items(id) on delete cascade,
  author_id         uuid references public.profiles(id) on delete set null,
  author_contact_id uuid references public.client_contacts(id) on delete set null,
  body              text not null check (char_length(body) between 1 and 5000),
  -- Internal notes stay hidden from the client portal.
  visible_to_client boolean not null default false,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------- indexes
create index if not exists content_agency_date_idx on public.content_items (agency_id, scheduled_date);
create index if not exists content_client_idx      on public.content_items (client_id, scheduled_date);
create index if not exists content_status_idx      on public.content_items (agency_id, status);
create index if not exists content_assignee_idx    on public.content_items (assignee_id, status);
create index if not exists approvals_item_idx      on public.content_approvals (content_item_id, round desc);
create index if not exists approvals_pending_idx   on public.content_approvals (agency_id, decision);
create index if not exists content_comments_idx    on public.content_comments (content_item_id, created_at);

-- ---------------------------------------------------------------- triggers
drop trigger if exists touch_content_items on public.content_items;
create trigger touch_content_items before update on public.content_items
  for each row execute function public.touch_updated_at();

-- Stamp published_at when an item goes live, and clear it if it comes back.
create or replace function public.content_published_at() returns trigger
language plpgsql as $$
begin
  if new.status = 'published' and (old.status is distinct from 'published') then
    new.published_at = coalesce(new.published_at, now());
  elsif new.status <> 'published' then
    new.published_at = null;
  end if;
  return new;
end $$;

drop trigger if exists content_published_at on public.content_items;
create trigger content_published_at before update of status on public.content_items
  for each row execute function public.content_published_at();

-- ---------------------------------------------------------------- RPC
-- Sends an item to the client: opens the next approval round and moves the
-- item's status in one transaction, so the two can never drift apart.
create or replace function public.request_content_approval(item_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  item   content_items%rowtype;
  next_round integer;
  new_id uuid;
begin
  select * into item from content_items where id = item_id;
  if not found then raise exception 'Content item not found'; end if;
  if not public.is_staff(item.agency_id) then raise exception 'Not allowed'; end if;

  -- Re-requesting while a round is already open is a no-op, not a new round.
  select id into new_id from content_approvals
   where content_item_id = item_id and decision = 'pending' limit 1;
  if new_id is not null then
    update content_items set status = 'client_approval' where id = item_id;
    return new_id;
  end if;

  select coalesce(max(round), 0) + 1 into next_round
    from content_approvals where content_item_id = item_id;

  insert into content_approvals (agency_id, content_item_id, round, requested_by)
  values (item.agency_id, item_id, next_round, auth.uid())
  returning id into new_id;

  update content_items set status = 'client_approval' where id = item_id;

  insert into activity_log (agency_id, actor_id, entity_type, entity_id, action, meta)
  values (item.agency_id, auth.uid(), 'content', item_id, 'approval_requested',
          jsonb_build_object('title', item.title, 'round', next_round));
  return new_id;
end $$;

-- Records a decision on the open round. Asking for changes counts a revision,
-- which is what the revisions-vs-scope warning on the item is based on.
create or replace function public.decide_content_approval(
  approval_id uuid,
  new_decision approval_decision,
  decision_comment text default null,
  contact_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  appr content_approvals%rowtype;
  item content_items%rowtype;
begin
  if new_decision = 'pending' then raise exception 'Choose approved or changes_requested'; end if;

  select * into appr from content_approvals where id = approval_id;
  if not found then raise exception 'Approval not found'; end if;
  if appr.decision <> 'pending' then raise exception 'This round has already been decided'; end if;
  if not public.is_staff(appr.agency_id) then raise exception 'Not allowed'; end if;

  select * into item from content_items where id = appr.content_item_id;

  update content_approvals
     set decision = new_decision,
         comment = decision_comment,
         decided_at = now(),
         decided_by_profile_id = auth.uid(),
         decided_by_contact_id = contact_id,
         on_behalf = true
   where id = approval_id;

  if new_decision = 'approved' then
    -- The casts are required: a bare CASE yields text, which Postgres will not
    -- implicitly coerce to content_status.
    update content_items
       set status = case
                      when scheduled_date is not null then 'scheduled'::content_status
                      else 'approved'::content_status
                    end
     where id = appr.content_item_id;
  else
    update content_items
       set status = 'changes_requested', revision_count = revision_count + 1
     where id = appr.content_item_id;
  end if;

  insert into activity_log (agency_id, actor_id, entity_type, entity_id, action, meta)
  values (appr.agency_id, auth.uid(), 'content', appr.content_item_id,
          case when new_decision = 'approved' then 'approved' else 'changes_requested' end,
          jsonb_build_object('title', item.title, 'round', appr.round));
end $$;

grant execute on function public.request_content_approval(uuid) to authenticated;
grant execute on function public.decide_content_approval(uuid, approval_decision, text, uuid) to authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.content_items     enable row level security;
alter table public.content_approvals enable row level security;
alter table public.content_comments  enable row level security;

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('content_items','content_approvals','content_comments') loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- content items: staff see everything, freelancers only what is assigned to them
create policy content_select on public.content_items for select using (
  public.is_staff(agency_id)
  or (public.is_member(agency_id) and assignee_id = auth.uid())
);
create policy content_insert on public.content_items for insert with check (public.is_staff(agency_id));
create policy content_update on public.content_items for update
  using (public.is_staff(agency_id) or (public.is_member(agency_id) and assignee_id = auth.uid()))
  with check (public.is_staff(agency_id) or (public.is_member(agency_id) and assignee_id = auth.uid()));
create policy content_delete on public.content_items for delete using (public.is_manager(agency_id));

-- approvals: readable by anyone who can see the item; written through the RPCs
create policy approvals_select on public.content_approvals for select using (
  exists (select 1 from public.content_items ci where ci.id = content_approvals.content_item_id)
);
create policy approvals_insert on public.content_approvals for insert
  with check (public.is_staff(agency_id));
create policy approvals_delete on public.content_approvals for delete using (public.is_manager(agency_id));

-- comments: anyone who can see the item
create policy content_comments_select on public.content_comments for select using (
  exists (select 1 from public.content_items ci where ci.id = content_comments.content_item_id)
);
create policy content_comments_insert on public.content_comments for insert with check (
  author_id = auth.uid() and public.is_member(agency_id)
  and exists (select 1 from public.content_items ci where ci.id = content_comments.content_item_id)
);
create policy content_comments_delete on public.content_comments for delete
  using (author_id = auth.uid() or public.is_manager(agency_id));
