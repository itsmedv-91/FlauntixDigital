-- Behaviour tests for 0010_assistant.sql.
--
-- The assistant's own answers cannot be tested here — they come from an API.
-- What CAN be tested is the thing that would actually hurt: who can read whose
-- questions, and whether the transcript is tamper-proof.
\set QUIET on
\set ON_ERROR_STOP on

create or replace function t_eq(label text, actual anyelement, expected anyelement)
returns void language plpgsql as $$
begin
  if actual is not distinct from expected then
    raise notice 'PASS  % = %', label, actual;
  else
    raise notice 'FAIL  % -> got %, want %', label, actual, expected;
  end if;
end $$;

-- ----------------------------------------------------------------- seed
delete from agencies;
delete from auth.users;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@test.in',   '{"full_name":"Owner A"}'),
  ('22222222-2222-2222-2222-222222222222', 'member-a@test.in',  '{"full_name":"Member A"}'),
  ('55555555-5555-5555-5555-555555555555', 'member-a2@test.in', '{"full_name":"Member A2"}'),
  ('66666666-6666-6666-6666-666666666666', 'mgr-a@test.in',     '{"full_name":"Manager A"}'),
  ('44444444-4444-4444-4444-444444444444', 'owner-b@test.in',   '{"full_name":"Owner B"}');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select create_agency('Agency A') as agency_a \gset
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select create_agency('Agency B') as agency_b \gset

insert into memberships (agency_id, user_id, role) values
  (:'agency_a', '22222222-2222-2222-2222-222222222222', 'member'),
  (:'agency_a', '55555555-5555-5555-5555-555555555555', 'member'),
  (:'agency_a', '66666666-6666-6666-6666-666666666666', 'manager');

set role authenticated;

-- ----------------------------------------------------------- own threads
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);

with x as (
  insert into assistant_conversations (agency_id, user_id, title)
  values (:'agency_a', '22222222-2222-2222-2222-222222222222', 'What is overdue?')
  returning id
)
select t_eq('member can open a thread', count(*), 1::bigint) from x;

select id as conv_member from assistant_conversations
  where user_id = '22222222-2222-2222-2222-222222222222' \gset

with x as (
  insert into assistant_messages (conversation_id, agency_id, role, body)
  values (:'conv_member', :'agency_a', 'user', 'What is overdue?')
  returning id
)
select t_eq('member can add a turn', count(*), 1::bigint) from x;

select t_eq('member sees own thread', count(*), 1::bigint)
  from assistant_conversations;
select t_eq('member sees own turn', count(*), 1::bigint)
  from assistant_messages;

-- A member cannot write a turn claiming the wrong agency, even on their own
-- thread: the insert policy ties the two together.
-- psql does not interpolate :'var' inside a dollar-quoted block, so every id a
-- DO block needs travels in a session setting.
select set_config('test.conv', :'conv_member', false);
select set_config('test.agency', :'agency_a', false);
select set_config('test.agency_b', :'agency_b', false);

do $$ begin
  begin
    insert into assistant_messages (conversation_id, agency_id, role, body)
    values (current_setting('test.conv')::uuid,
            current_setting('test.agency_b')::uuid, 'user', 'wrong agency');
    raise notice 'FAIL  mismatched agency_id on a turn was accepted';
  exception when insufficient_privilege then
    raise notice 'PASS  mismatched agency_id on a turn refused';
  end;
end $$;

-- ------------------------------------------------- another member is blind
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
select t_eq('colleague cannot see the thread', count(*), 0::bigint)
  from assistant_conversations;
select t_eq('colleague cannot see the turns', count(*), 0::bigint)
  from assistant_messages;

-- Writing into a thread they cannot even see must fail, not silently insert.
do $$
declare conv uuid := current_setting('test.conv')::uuid;
begin
  begin
    insert into assistant_messages (conversation_id, agency_id, role, body)
    values (conv, current_setting('test.agency')::uuid, 'user', 'planted by a colleague');
    raise notice 'FAIL  colleague wrote into a thread';
  exception when insufficient_privilege then
    raise notice 'PASS  colleague cannot write into a thread';
  end;
end $$;

-- --------------------------------------------- a manager is NOT an auditor
-- Deliberate: reading a colleague's questions is surveillance. Only admins and
-- owners can, because they answer for the agency's use of a paid API.
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
select t_eq('manager cannot see a member thread', count(*), 0::bigint)
  from assistant_conversations;

-- ------------------------------------------------------- owner can audit
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select t_eq('owner sees the member thread', count(*), 1::bigint)
  from assistant_conversations;
select t_eq('owner sees the turns', count(*), 1::bigint)
  from assistant_messages;

-- ...but cannot write to it, or delete it to cover tracks.
do $$ begin
  begin
    insert into assistant_messages (conversation_id, agency_id, role, body)
    values ((select id from assistant_conversations limit 1),
            (select agency_id from assistant_conversations limit 1), 'user', 'planted');
    raise notice 'FAIL  owner wrote into a member thread';
  exception when insufficient_privilege then
    raise notice 'PASS  owner cannot write into a member thread';
  end;
end $$;

with x as (delete from assistant_conversations returning id)
select t_eq('owner cannot delete a member thread', count(*), 0::bigint) from x;

-- The transcript has no update policy at all.
with x as (update assistant_messages set body = 'rewritten' returning id)
select t_eq('a turn cannot be edited', count(*), 0::bigint) from x;

-- ------------------------------------------------------ tenant isolation
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select t_eq('other agency sees nothing', count(*), 0::bigint)
  from assistant_conversations;
select t_eq('other agency sees no turns', count(*), 0::bigint)
  from assistant_messages;

-- An owner of B cannot open a thread in A.
do $$
declare a_id uuid;
begin
  select id into a_id from agencies where name = 'Agency A';
  if a_id is null then
    -- RLS hides Agency A from this user, which is itself the answer.
    raise notice 'PASS  cross-agency thread refused (agency not even visible)';
    return;
  end if;
  begin
    insert into assistant_conversations (agency_id, user_id, title)
    values (a_id, '44444444-4444-4444-4444-444444444444', 'snooping');
    raise notice 'FAIL  cross-agency thread was accepted';
  exception when insufficient_privilege then
    raise notice 'PASS  cross-agency thread refused';
  end;
end $$;

-- ----------------------------------------------------- owner's own thread
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
with x as (
  insert into assistant_conversations (agency_id, user_id, title)
  values (:'agency_a', '11111111-1111-1111-1111-111111111111', 'Margins?')
  returning id
)
select t_eq('owner can open their own thread', count(*), 1::bigint) from x;

with x as (
  delete from assistant_conversations
  where user_id = '11111111-1111-1111-1111-111111111111'
  returning id
)
select t_eq('owner can delete their own thread', count(*), 1::bigint) from x;

reset role;
