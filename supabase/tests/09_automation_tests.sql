-- Behaviour tests for 0011_automations.sql.
--
-- The thing worth testing hardest is idempotency: a reminder that repeats every
-- hour is worse than no reminder at all.
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
  ('11111111-1111-1111-1111-111111111111', 'owner-a@test.in',  '{"full_name":"Owner A"}'),
  ('22222222-2222-2222-2222-222222222222', 'member-a@test.in', '{"full_name":"Member A"}'),
  ('66666666-6666-6666-6666-666666666666', 'mgr-a@test.in',    '{"full_name":"Manager A"}'),
  ('44444444-4444-4444-4444-444444444444', 'owner-b@test.in',  '{"full_name":"Owner B"}');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select create_agency('Agency A') as agency_a \gset
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select create_agency('Agency B') as agency_b \gset

insert into memberships (agency_id, user_id, role) values
  (:'agency_a', '22222222-2222-2222-2222-222222222222', 'member'),
  (:'agency_a', '66666666-6666-6666-6666-666666666666', 'manager');

insert into clients (id, agency_id, name, status, state_code, contract_end) values
  ('aaaaaaaa-0000-0000-0000-000000000001', :'agency_a', 'Auto Client', 'active', '27',
   ((now() at time zone 'Asia/Kolkata')::date + 10)),
  ('aaaaaaaa-0000-0000-0000-000000000002', :'agency_a', 'Other Client', 'active', '27', null);

-- Two overdue tasks for one client, one overdue task for the other, and one
-- task that is overdue but done (must be ignored).
insert into tasks (agency_id, client_id, title, status, due_date) values
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', 'Late A', 'todo',
   ((now() at time zone 'Asia/Kolkata')::date - 5)),
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', 'Late B', 'in_progress',
   ((now() at time zone 'Asia/Kolkata')::date - 2)),
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000002', 'Late C', 'todo',
   ((now() at time zone 'Asia/Kolkata')::date - 9)),
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', 'Late but finished', 'done',
   ((now() at time zone 'Asia/Kolkata')::date - 9)),
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', 'Due tomorrow', 'todo',
   ((now() at time zone 'Asia/Kolkata')::date + 1));

select id as chan from channels where agency_id = :'agency_a' limit 1 \gset

set role authenticated;

-- ----------------------------------------------------- who can own a rule
select set_config('test.agency', :'agency_a', false);
select set_config('test.chan', :'chan', false);
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);

do $$ begin
  begin
    insert into automation_rules (agency_id, name, trigger, threshold_days, action, channel_id)
    values (current_setting('test.agency')::uuid, 'Member rule', 'task_overdue', 1,
            'chat_message', current_setting('test.chan')::uuid);
    raise notice 'FAIL  a member created a rule';
  exception when insufficient_privilege then
    raise notice 'PASS  a member cannot create a rule';
  end;
end $$;

do $$ begin
  begin
    perform run_automations(current_setting('test.agency')::uuid);
    raise notice 'FAIL  a member ran the automations';
  exception when others then
    raise notice 'PASS  a member cannot run the automations';
  end;
end $$;

-- ------------------------------------------------------- the manager's rule
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);

with x as (
  insert into automation_rules (agency_id, name, trigger, threshold_days, action, channel_id)
  values (:'agency_a', 'Chase overdue', 'task_overdue', 3, 'chat_message', :'chan')
  returning id
)
select t_eq('a manager can create a rule', count(*), 1::bigint) from x;

-- 5 days and 9 days overdue clear a 3-day threshold; 2 days does not, nor does
-- the finished one or the one not yet due.
select t_eq('first run acts on the two tasks past the threshold',
            run_automations(:'agency_a'), 2);
select t_eq('two messages posted', count(*), 2::bigint)
  from messages where body like '%Chase overdue%';

-- The whole point: nothing happens the second time.
select t_eq('second run acts on nothing', run_automations(:'agency_a'), 0);
select t_eq('still only two messages', count(*), 2::bigint)
  from messages where body like '%Chase overdue%';

select t_eq('the log records both', count(*), 2::bigint) from automation_events;
select t_eq('last_run_at was stamped', (select count(*) from automation_rules where last_run_at is not null), 1::bigint);

-- A pause means a pause.
update automation_rules set active = false where name = 'Chase overdue';
select t_eq('a paused rule does nothing', run_automations(:'agency_a'), 0);
update automation_rules set active = true where name = 'Chase overdue';

-- ----------------------------------------------- scoping a rule to a client
with x as (
  insert into automation_rules (agency_id, name, trigger, threshold_days, action, channel_id, client_id)
  values (:'agency_a', 'Client one only', 'task_overdue', 1, 'chat_message', :'chan',
          'aaaaaaaa-0000-0000-0000-000000000001')
  returning id
)
select t_eq('client-scoped rule created', count(*), 1::bigint) from x;

-- Two overdue tasks belong to that client (5 and 2 days); the 9-day one is the
-- other client's and must not be touched.
select t_eq('client-scoped rule sees only its client', run_automations(:'agency_a'), 2);
select t_eq('nothing mentions the other client''s task', count(*), 0::bigint)
  from automation_events e
  join automation_rules r on r.id = e.rule_id
  where r.name = 'Client one only' and e.summary like '%Late C%';

-- ------------------------------------------------- a task-creating action
with x as (
  insert into automation_rules (agency_id, name, trigger, threshold_days, action, assignee_id)
  values (:'agency_a', 'Renewal prep', 'contract_renewal_soon', 30, 'create_task',
          '66666666-6666-6666-6666-666666666666')
  returning id
)
select t_eq('renewal rule created', count(*), 1::bigint) from x;

select t_eq('renewal rule opens one task', run_automations(:'agency_a'), 1);
select t_eq('the task exists and is assigned', count(*), 1::bigint)
  from tasks
  where title like 'Contract for Auto Client%'
    and assignee_id = '66666666-6666-6666-6666-666666666666';
select t_eq('the renewal task is not repeated', run_automations(:'agency_a'), 0);

-- ------------------------------------------------------ tenant isolation
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select t_eq('other agency sees no rules', count(*), 0::bigint) from automation_rules;
select t_eq('other agency sees no events', count(*), 0::bigint) from automation_events;

do $$ begin
  begin
    perform run_automations(current_setting('test.agency')::uuid);
    raise notice 'FAIL  another agency ran our automations';
  exception when others then
    raise notice 'PASS  another agency cannot run our automations';
  end;
end $$;

-- ------------------------------------------------- the log is append-only
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);

with x as (update automation_events set summary = 'rewritten' returning id)
select t_eq('an event cannot be edited', count(*), 0::bigint) from x;
with x as (delete from automation_events returning id)
select t_eq('an event cannot be deleted', count(*), 0::bigint) from x;
do $$ begin
  begin
    insert into automation_events (agency_id, rule_id, dedupe_key, entity_type, summary)
    values (current_setting('test.agency')::uuid,
            (select id from automation_rules limit 1), 'forged', 'task', 'forged');
    raise notice 'FAIL  an event could be forged';
  exception when insufficient_privilege then
    raise notice 'PASS  an event cannot be forged';
  end;
end $$;

-- ----------------------------------------- the cron sweep is unreachable
do $$ begin
  begin
    perform run_all_automations();
    raise notice 'FAIL  run_all_automations() is callable from the API';
  exception when insufficient_privilege then
    raise notice 'PASS  run_all_automations() is not callable from the API';
  end;
end $$;
do $$ begin
  begin
    perform run_automations_core(current_setting('test.agency')::uuid);
    raise notice 'FAIL  run_automations_core() is callable from the API';
  exception when insufficient_privilege then
    raise notice 'PASS  run_automations_core() is not callable from the API';
  end;
end $$;

reset role;
