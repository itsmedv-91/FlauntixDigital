-- =============================================================================
-- Flauntix Platform — Phase 1 (Foundation)
-- Multi-tenant schema: every business row carries agency_id, and row-level
-- security restricts each user to the agencies they belong to, by role.
-- Run in Supabase: SQL Editor → paste → Run (or `supabase db push`).
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums
do $$ begin create type member_role    as enum ('owner','admin','manager','member','freelancer');
exception when duplicate_object then null; end $$;
do $$ begin create type lead_stage     as enum ('new','contacted','discovery','proposal','negotiation','won','lost');
exception when duplicate_object then null; end $$;
do $$ begin create type task_status    as enum ('todo','in_progress','internal_review','client_approval','done');
exception when duplicate_object then null; end $$;
do $$ begin create type task_priority  as enum ('low','medium','high','urgent');
exception when duplicate_object then null; end $$;
do $$ begin create type project_status as enum ('planning','active','on_hold','completed','cancelled');
exception when duplicate_object then null; end $$;
do $$ begin create type client_status  as enum ('onboarding','active','paused','churned');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tables
create table if not exists public.agencies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  slug        text unique,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text,
  avatar_url  text,
  job_title   text,
  skills      text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create table if not exists public.memberships (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        member_role not null default 'member',
  hourly_cost numeric(10,2),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (agency_id, user_id)
);

create table if not exists public.invitations (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  email       text not null,
  role        member_role not null default 'member',
  token       text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by  uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  expires_at  timestamptz not null default now() + interval '14 days',
  created_at  timestamptz not null default now()
);

create table if not exists public.clients (
  id                 uuid primary key default gen_random_uuid(),
  agency_id          uuid not null references public.agencies(id) on delete cascade,
  name               text not null,
  industry           text,
  website            text,
  status             client_status not null default 'onboarding',
  account_manager_id uuid references public.profiles(id) on delete set null,
  services           text[] not null default '{}',
  monthly_retainer   numeric(12,2),
  contract_start     date,
  contract_end       date,
  brand_colors       text,
  brand_voice        text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.client_contacts (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  name        text not null,
  email       text,
  phone       text,
  designation text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.leads (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references public.agencies(id) on delete cascade,
  company             text not null,
  contact_name        text,
  email               text,
  phone               text,
  source              text,
  services_interested text[] not null default '{}',
  estimated_value     numeric(12,2),
  stage               lead_stage not null default 'new',
  owner_id            uuid references public.profiles(id) on delete set null,
  next_follow_up      date,
  lost_reason         text,
  notes               text,
  converted_client_id uuid references public.clients(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  client_id   uuid references public.clients(id) on delete set null,
  name        text not null,
  description text,
  status      project_status not null default 'planning',
  start_date  date,
  due_date    date,
  budget      numeric(12,2),
  owner_id    uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.tasks (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  project_id     uuid references public.projects(id) on delete cascade,
  client_id      uuid references public.clients(id) on delete set null,
  title          text not null,
  description    text,
  status         task_status not null default 'todo',
  priority       task_priority not null default 'medium',
  assignee_id    uuid references public.profiles(id) on delete set null,
  created_by     uuid references public.profiles(id) on delete set null,
  due_date       date,
  estimate_hours numeric(6,2),
  position       double precision not null default 0,
  revision_count integer not null default 0,
  max_revisions  integer,
  tags           text[] not null default '{}',
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  task_id    uuid not null references public.tasks(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  body       text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);

create table if not exists public.time_entries (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  task_id    uuid references public.tasks(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  client_id  uuid references public.clients(id) on delete set null,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  minutes    integer check (minutes is null or minutes >= 0),
  note       text,
  billable   boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.channels (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  name       text not null,
  kind       text not null default 'general' check (kind in ('general','client','project','department')),
  client_id  uuid references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);

-- Secrets are AES-256-GCM encrypted by the app server before insert.
create table if not exists public.credentials (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null references public.agencies(id) on delete cascade,
  client_id         uuid not null references public.clients(id) on delete cascade,
  platform          text not null,
  label             text,
  username          text,
  url               text,
  secret_ciphertext text not null,
  notes             text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.activity_log (
  id          bigint generated always as identity primary key,
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id   uuid,
  action      text not null,
  meta        jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- indexes
create index if not exists memberships_user_idx   on public.memberships (user_id);
create index if not exists clients_agency_idx     on public.clients (agency_id);
create index if not exists contacts_client_idx    on public.client_contacts (client_id);
create index if not exists leads_agency_idx       on public.leads (agency_id, stage);
create index if not exists projects_agency_idx    on public.projects (agency_id, client_id);
create index if not exists tasks_agency_idx       on public.tasks (agency_id, status);
create index if not exists tasks_assignee_idx     on public.tasks (assignee_id, status);
create index if not exists tasks_project_idx      on public.tasks (project_id);
create index if not exists comments_task_idx      on public.task_comments (task_id, created_at);
create index if not exists time_user_idx          on public.time_entries (user_id, started_at);
create index if not exists time_agency_idx        on public.time_entries (agency_id, started_at);
create index if not exists messages_channel_idx   on public.messages (channel_id, created_at);
create index if not exists credentials_client_idx on public.credentials (client_id);
create index if not exists activity_agency_idx    on public.activity_log (agency_id, created_at desc);
create index if not exists invitations_email_idx  on public.invitations (lower(email));

-- ---------------------------------------------------------------- updated_at
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['clients','leads','projects','tasks','credentials'] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$s', t);
    execute format('create trigger touch_%1$s before update on public.%1$s
                    for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- Stamp completed_at when a task moves to / from done.
create or replace function public.task_completed_at() returns trigger
language plpgsql as $$
begin
  if new.status = 'done' and (old.status is distinct from 'done') then
    new.completed_at = now();
  elsif new.status <> 'done' then
    new.completed_at = null;
  end if;
  return new;
end $$;

drop trigger if exists task_completed_at on public.tasks;
create trigger task_completed_at before update of status on public.tasks
  for each row execute function public.task_completed_at();

-- ---------------------------------------------------------------- auth → profile
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- access helpers
-- SECURITY DEFINER so policies can check membership without recursing into
-- the memberships table's own policies.
create or replace function public.is_member(a uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships
    where agency_id = a and user_id = auth.uid() and active
  );
$$;

create or replace function public.has_role(a uuid, roles member_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships
    where agency_id = a and user_id = auth.uid() and active and role = any(roles)
  );
$$;

create or replace function public.is_staff(a uuid) returns boolean
language sql stable as $$
  select public.has_role(a, array['owner','admin','manager','member']::member_role[]);
$$;

create or replace function public.is_manager(a uuid) returns boolean
language sql stable as $$
  select public.has_role(a, array['owner','admin','manager']::member_role[]);
$$;

create or replace function public.is_admin(a uuid) returns boolean
language sql stable as $$
  select public.has_role(a, array['owner','admin']::member_role[]);
$$;

create or replace function public.shares_agency(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select other = auth.uid() or exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.agency_id = mine.agency_id
    where mine.user_id = auth.uid() and mine.active and theirs.user_id = other
  );
$$;

-- ---------------------------------------------------------------- RPCs
-- Creates an agency, makes the caller its owner and opens a #general channel.
create or replace function public.create_agency(agency_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  base_slug text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if coalesce(trim(agency_name), '') = '' then raise exception 'Agency name is required'; end if;

  base_slug := trim(both '-' from regexp_replace(lower(agency_name), '[^a-z0-9]+', '-', 'g'));
  insert into agencies (name, slug, created_by)
  values (trim(agency_name), base_slug || '-' || substr(gen_random_uuid()::text, 1, 6), auth.uid())
  returning id into new_id;

  insert into memberships (agency_id, user_id, role) values (new_id, auth.uid(), 'owner');
  insert into channels (agency_id, name, kind, created_by) values (new_id, 'general', 'general', auth.uid());
  insert into activity_log (agency_id, actor_id, entity_type, entity_id, action)
  values (new_id, auth.uid(), 'agency', new_id, 'created');
  return new_id;
end $$;

-- Accepts an invitation addressed to the signed-in user's email.
create or replace function public.accept_invitation(invite_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  inv invitations%rowtype;
  my_email text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select email into my_email from auth.users where id = auth.uid();

  select * into inv from invitations where token = invite_token;
  if not found then raise exception 'Invitation not found'; end if;
  if inv.accepted_at is not null then raise exception 'Invitation already used'; end if;
  if inv.expires_at < now() then raise exception 'Invitation has expired'; end if;
  if lower(inv.email) <> lower(my_email) then
    raise exception 'This invitation was sent to %, but you are signed in as %', inv.email, my_email;
  end if;

  insert into memberships (agency_id, user_id, role)
  values (inv.agency_id, auth.uid(), inv.role)
  on conflict (agency_id, user_id) do update set role = excluded.role, active = true;

  update invitations set accepted_at = now() where id = inv.id;
  insert into activity_log (agency_id, actor_id, entity_type, entity_id, action, meta)
  values (inv.agency_id, auth.uid(), 'member', auth.uid(), 'joined', jsonb_build_object('role', inv.role));
  return inv.agency_id;
end $$;

-- Public lookup used by the invite page before sign-in (no sensitive fields).
create or replace function public.invitation_preview(invite_token text)
returns table (agency_name text, email text, role member_role, expired boolean, accepted boolean)
language sql stable security definer set search_path = public as $$
  select a.name, i.email, i.role, i.expires_at < now(), i.accepted_at is not null
  from invitations i join agencies a on a.id = i.agency_id
  where i.token = invite_token;
$$;

grant execute on function public.create_agency(text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.invitation_preview(text) to anon, authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.agencies        enable row level security;
alter table public.profiles        enable row level security;
alter table public.memberships     enable row level security;
alter table public.invitations     enable row level security;
alter table public.clients         enable row level security;
alter table public.client_contacts enable row level security;
alter table public.leads           enable row level security;
alter table public.projects        enable row level security;
alter table public.tasks           enable row level security;
alter table public.task_comments   enable row level security;
alter table public.time_entries    enable row level security;
alter table public.channels        enable row level security;
alter table public.messages        enable row level security;
alter table public.credentials     enable row level security;
alter table public.activity_log    enable row level security;

-- Drop existing policies so this file can be re-run safely.
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('agencies','profiles','memberships','invitations','clients',
                               'client_contacts','leads','projects','tasks','task_comments',
                               'time_entries','channels','messages','credentials','activity_log') loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- agencies
create policy agencies_select on public.agencies for select using (public.is_member(id));
create policy agencies_update on public.agencies for update using (public.is_admin(id)) with check (public.is_admin(id));

-- profiles
create policy profiles_select on public.profiles for select using (public.shares_agency(id));
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- memberships
create policy memberships_select on public.memberships for select using (public.is_member(agency_id));
create policy memberships_update on public.memberships for update
  using (public.is_admin(agency_id) and user_id <> auth.uid() and role <> 'owner')
  with check (public.is_admin(agency_id) and role <> 'owner');
create policy memberships_delete on public.memberships for delete
  using (public.is_admin(agency_id) and user_id <> auth.uid() and role <> 'owner');

-- invitations
create policy invitations_select on public.invitations for select using (public.is_admin(agency_id));
create policy invitations_insert on public.invitations for insert
  with check (public.is_admin(agency_id) and role <> 'owner');
create policy invitations_delete on public.invitations for delete using (public.is_admin(agency_id));

-- clients: staff see all; freelancers only clients of tasks assigned to them
create policy clients_select on public.clients for select using (
  public.is_staff(agency_id)
  or (public.is_member(agency_id) and exists (
        select 1 from public.tasks t where t.client_id = clients.id and t.assignee_id = auth.uid()))
);
create policy clients_insert on public.clients for insert with check (public.is_manager(agency_id));
create policy clients_update on public.clients for update using (public.is_manager(agency_id)) with check (public.is_manager(agency_id));
create policy clients_delete on public.clients for delete using (public.is_admin(agency_id));

-- client contacts
create policy contacts_select on public.client_contacts for select using (public.is_staff(agency_id));
create policy contacts_write  on public.client_contacts for all
  using (public.is_manager(agency_id)) with check (public.is_manager(agency_id));

-- leads (CRM): staff can read, managers manage
create policy leads_select on public.leads for select using (public.is_staff(agency_id));
create policy leads_write  on public.leads for all
  using (public.is_manager(agency_id)) with check (public.is_manager(agency_id));

-- projects
create policy projects_select on public.projects for select using (
  public.is_staff(agency_id)
  or (public.is_member(agency_id) and exists (
        select 1 from public.tasks t where t.project_id = projects.id and t.assignee_id = auth.uid()))
);
create policy projects_insert on public.projects for insert with check (public.is_manager(agency_id));
create policy projects_update on public.projects for update using (public.is_manager(agency_id)) with check (public.is_manager(agency_id));
create policy projects_delete on public.projects for delete using (public.is_admin(agency_id));

-- tasks: staff see all, freelancers only their own
create policy tasks_select on public.tasks for select using (
  public.is_staff(agency_id) or (public.is_member(agency_id) and assignee_id = auth.uid())
);
create policy tasks_insert on public.tasks for insert with check (public.is_staff(agency_id));
create policy tasks_update on public.tasks for update
  using (public.is_staff(agency_id) or (public.is_member(agency_id) and assignee_id = auth.uid()))
  with check (public.is_staff(agency_id) or (public.is_member(agency_id) and assignee_id = auth.uid()));
create policy tasks_delete on public.tasks for delete
  using (public.is_manager(agency_id) or (public.is_staff(agency_id) and created_by = auth.uid()));

-- task comments: anyone who can see the task
create policy comments_select on public.task_comments for select using (
  exists (select 1 from public.tasks t where t.id = task_comments.task_id)
);
create policy comments_insert on public.task_comments for insert with check (
  author_id = auth.uid() and public.is_member(agency_id)
  and exists (select 1 from public.tasks t where t.id = task_comments.task_id)
);
create policy comments_delete on public.task_comments for delete
  using (author_id = auth.uid() or public.is_manager(agency_id));

-- time entries: own entries; managers see everyone's
create policy time_select on public.time_entries for select
  using (user_id = auth.uid() or public.is_manager(agency_id));
create policy time_insert on public.time_entries for insert
  with check (user_id = auth.uid() and public.is_member(agency_id));
create policy time_update on public.time_entries for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy time_delete on public.time_entries for delete
  using (user_id = auth.uid() or public.is_manager(agency_id));

-- channels: staff see all; freelancers only #general-type channels
create policy channels_select on public.channels for select using (
  public.is_staff(agency_id) or (public.is_member(agency_id) and kind = 'general')
);
create policy channels_insert on public.channels for insert with check (public.is_staff(agency_id));
create policy channels_delete on public.channels for delete using (public.is_manager(agency_id));

-- messages
create policy messages_select on public.messages for select using (
  exists (select 1 from public.channels c where c.id = messages.channel_id)
);
create policy messages_insert on public.messages for insert with check (
  author_id = auth.uid() and public.is_member(agency_id)
  and exists (select 1 from public.channels c where c.id = messages.channel_id)
);
create policy messages_update on public.messages for update
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy messages_delete on public.messages for delete
  using (author_id = auth.uid() or public.is_manager(agency_id));

-- credentials vault: managers and above only
create policy credentials_all on public.credentials for all
  using (public.is_manager(agency_id)) with check (public.is_manager(agency_id));

-- activity log
create policy activity_select on public.activity_log for select using (public.is_staff(agency_id));
create policy activity_insert on public.activity_log for insert
  with check (actor_id = auth.uid() and public.is_member(agency_id));

-- ---------------------------------------------------------------- realtime
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; when undefined_object then null; end $$;
