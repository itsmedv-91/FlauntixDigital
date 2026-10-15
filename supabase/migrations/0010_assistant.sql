-- =============================================================================
-- Flauntix Platform — Phase 4, part 1: AI assistant (audit trail)
--
-- The assistant itself is read-only: it answers questions about the agency's
-- own data and has NO tools, so it cannot change anything. What it DOES need is
-- a record, because the answers are built from a snapshot of real client data
-- and somebody will eventually ask "what did it say about this client, and who
-- asked?".
--
-- Two tables, nothing clever:
--   assistant_conversations — one per thread, owned by the person who started it
--   assistant_messages      — the turns, in order, with the token usage
--
-- Visibility: your own threads, plus admins and owners for audit. Deliberately
-- NOT is_manager: a manager reading a colleague's questions is surveillance,
-- whereas an admin needs it to answer for the agency's use of a paid API.
--
-- Idempotent. Requires 0001.
-- =============================================================================

create table if not exists public.assistant_conversations (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  title      text not null default 'New question',
  /** Optional focus, so a thread about one client stays about that client. */
  client_id  uuid references public.clients(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assistant_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  agency_id       uuid not null references public.agencies(id) on delete cascade,
  role            text not null check (role in ('user','assistant')),
  body            text not null,
  /** Null on a user turn. Which model answered, for when pricing changes. */
  model           text,
  input_tokens    integer,
  output_tokens   integer,
  /** Set when the call failed, so a broken key shows up instead of silence. */
  error           text,
  created_at      timestamptz not null default now()
);

create index if not exists assistant_conv_user_idx on public.assistant_conversations (agency_id, user_id, updated_at desc);
create index if not exists assistant_msg_conv_idx  on public.assistant_messages (conversation_id, created_at);

drop trigger if exists touch_assistant_conversations on public.assistant_conversations;
create trigger touch_assistant_conversations before update on public.assistant_conversations
  for each row execute function public.touch_updated_at();

alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages      enable row level security;

-- Your own threads; admins and owners for audit.
drop policy if exists assistant_conv_select on public.assistant_conversations;
create policy assistant_conv_select on public.assistant_conversations
  for select using (
    public.is_member(agency_id)
    and (user_id = auth.uid() or public.is_admin(agency_id))
  );

drop policy if exists assistant_conv_insert on public.assistant_conversations;
create policy assistant_conv_insert on public.assistant_conversations
  for insert with check (public.is_member(agency_id) and user_id = auth.uid());

drop policy if exists assistant_conv_update on public.assistant_conversations;
create policy assistant_conv_update on public.assistant_conversations
  for update using (public.is_member(agency_id) and user_id = auth.uid());

-- Only the owner of a thread deletes it. An admin can read the audit trail but
-- cannot quietly remove it.
drop policy if exists assistant_conv_delete on public.assistant_conversations;
create policy assistant_conv_delete on public.assistant_conversations
  for delete using (public.is_member(agency_id) and user_id = auth.uid());

drop policy if exists assistant_msg_select on public.assistant_messages;
create policy assistant_msg_select on public.assistant_messages
  for select using (
    exists (
      select 1 from public.assistant_conversations c
      where c.id = conversation_id
    )
  );

-- The subquery above runs under RLS, so it already means "a thread you can
-- see". Insert has to repeat the ownership test because an admin must not be
-- able to write turns into somebody else's thread.
drop policy if exists assistant_msg_insert on public.assistant_messages;
create policy assistant_msg_insert on public.assistant_messages
  for insert with check (
    public.is_member(agency_id)
    and exists (
      select 1 from public.assistant_conversations c
      where c.id = conversation_id
        and c.agency_id = assistant_messages.agency_id
        and c.user_id = auth.uid()
    )
  );

-- No update policy at all: a transcript that can be edited is not a transcript.
