-- Behaviour tests for 0013_plans.sql.
--
-- The limits are the feature, so most of this is about whether they actually
-- bite — and whether an agency can lift them for itself, which would make the
-- whole thing decorative.
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
  ('33333333-3333-3333-3333-333333333333', 'third-a@test.in',  '{"full_name":"Third A"}'),
  ('55555555-5555-5555-5555-555555555555', 'fourth-a@test.in', '{"full_name":"Fourth A"}'),
  ('44444444-4444-4444-4444-444444444444', 'owner-b@test.in',  '{"full_name":"Owner B"}');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select create_agency('Agency A') as agency_a \gset
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select create_agency('Agency B') as agency_b \gset
select set_config('test.agency', :'agency_a', false);

-- ------------------------------------------ an unsubscribed agency is free
select t_eq('no subscription means self-hosted', code, 'self_hosted')
  from agency_plan(:'agency_a');
select t_eq('self-hosted has no seat limit', max_members, null::integer)
  from agency_plan(:'agency_a');
select t_eq('self-hosted has every feature', plan_allows(:'agency_a', 'assistant'), true);

-- Four members on no plan: the thing that must not break for the agency that
-- already runs this platform.
insert into memberships (agency_id, user_id, role) values
  (:'agency_a', '22222222-2222-2222-2222-222222222222', 'member'),
  (:'agency_a', '33333333-3333-3333-3333-333333333333', 'member'),
  (:'agency_a', '55555555-5555-5555-5555-555555555555', 'member');
select t_eq('an unmetered agency can grow past any plan', count(*), 4::bigint)
  from memberships where agency_id = :'agency_a' and active;

-- ------------------------------------------------------- limits that bite
-- Solo allows 3 seats; the agency already has 4, so the next one is refused.
insert into agency_subscription (agency_id, plan_code, status) values (:'agency_a', 'solo', 'active');

select t_eq('the subscribed plan now applies', code, 'solo') from agency_plan(:'agency_a');
select t_eq('a solo plan has no assistant', plan_allows(:'agency_a', 'assistant'), false);
select t_eq('a solo plan does have invoicing', plan_allows(:'agency_a', 'invoicing'), true);

insert into auth.users (id, email) values ('77777777-7777-7777-7777-777777777777', 'fifth@test.in');
do $$ begin
  begin
    insert into memberships (agency_id, user_id, role)
    values (current_setting('test.agency')::uuid, '77777777-7777-7777-7777-777777777777', 'member');
    raise notice 'FAIL  a fifth seat was allowed on a 3-seat plan';
  exception when check_violation then
    raise notice 'PASS  a seat beyond the plan is refused';
  end;
end $$;

-- Deactivating somebody frees a seat, so a swap needs no upgrade.
update memberships set active = false where user_id = '55555555-5555-5555-5555-555555555555';
update memberships set active = false where user_id = '33333333-3333-3333-3333-333333333333';
select t_eq('a deactivated member frees a seat', count(*), 2::bigint)
  from memberships where agency_id = :'agency_a' and active;
with x as (
  insert into memberships (agency_id, user_id, role)
  values (:'agency_a', '77777777-7777-7777-7777-777777777777', 'member')
  returning id
)
select t_eq('the freed seat can be used', count(*), 1::bigint) from x;

-- Extra seats bought outside the plan are honoured.
do $$ begin
  begin
    insert into memberships (agency_id, user_id, role)
    values (current_setting('test.agency')::uuid, '33333333-3333-3333-3333-333333333333', 'member');
    raise notice 'FAIL  a fourth seat was allowed on a 3-seat plan';
  exception when check_violation or unique_violation then
    raise notice 'PASS  the plan is still enforced at three';
  end;
end $$;
update agency_subscription set extra_seats = 2 where agency_id = :'agency_a';
with x as (
  update memberships set active = true
  where agency_id = :'agency_a' and user_id = '33333333-3333-3333-3333-333333333333'
  returning id
)
select t_eq('an extra seat lets a member back in', count(*), 1::bigint) from x;

-- ------------------------------------------------------- the client limit
insert into clients (agency_id, name, status) values
  (:'agency_a', 'C1', 'active'), (:'agency_a', 'C2', 'active'),
  (:'agency_a', 'C3', 'active'), (:'agency_a', 'C4', 'active'),
  (:'agency_a', 'C5', 'active');

do $$ begin
  begin
    insert into clients (agency_id, name, status)
    values (current_setting('test.agency')::uuid, 'C6', 'active');
    raise notice 'FAIL  a sixth client was allowed on a 5-client plan';
  exception when check_violation then
    raise notice 'PASS  a client beyond the plan is refused';
  end;
end $$;

-- A churned client is not a cost, so it does not hold a slot.
update clients set status = 'churned' where name = 'C5' and agency_id = :'agency_a';
with x as (
  insert into clients (agency_id, name, status) values (:'agency_a', 'C6', 'active') returning id
)
select t_eq('a churned client frees its slot', count(*), 1::bigint) from x;

-- An unlimited plan means unlimited, not a very large number.
update agency_subscription set plan_code = 'agency' where agency_id = :'agency_a';
with x as (
  insert into clients (agency_id, name, status) values (:'agency_a', 'C7', 'active') returning id
)
select t_eq('an unlimited client plan allows more', count(*), 1::bigint) from x;

set role authenticated;

-- ------------------------------------- an agency cannot upgrade itself
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

select t_eq('an owner can read their subscription', count(*), 1::bigint) from agency_subscription;
select t_eq('an owner can read the catalogue', count(*), 4::bigint) from plans where active;

do $$ begin
  begin
    update agency_subscription set plan_code = 'scale'
    where agency_id = current_setting('test.agency')::uuid;
    if found then
      raise notice 'FAIL  an owner upgraded their own plan';
    else
      raise notice 'PASS  an owner cannot upgrade their own plan';
    end if;
  exception when insufficient_privilege then
    raise notice 'PASS  an owner cannot upgrade their own plan';
  end;
end $$;
select t_eq('the plan is unchanged', plan_code, 'agency')
  from agency_subscription where agency_id = :'agency_a';

do $$ begin
  begin
    insert into agency_subscription (agency_id, plan_code, status)
    values (current_setting('test.agency')::uuid, 'scale', 'active');
    raise notice 'FAIL  an owner inserted a subscription';
  exception when insufficient_privilege or unique_violation then
    raise notice 'PASS  an owner cannot insert a subscription';
  end;
end $$;

-- A second trial, or a trial on top of a subscription, is refused.
do $$ begin
  begin
    perform start_trial(current_setting('test.agency')::uuid, 'scale', 14);
    raise notice 'FAIL  a trial was started over an existing subscription';
  exception when others then
    raise notice 'PASS  a trial cannot be started over an existing subscription';
  end;
end $$;

-- ------------------------------------------------- a trial on a fresh agency
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select set_config('test.agency_b', :'agency_b', false);

select start_trial(:'agency_b', 'studio', 14);
select t_eq('an owner can start a trial', count(*), 1::bigint)
  from agency_subscription where agency_id = :'agency_b';
select t_eq('the trial is on the right plan', code, 'studio') from agency_plan(:'agency_b');
select t_eq('the trial has an end date', (trial_ends_on is not null), true)
  from agency_subscription where agency_id = :'agency_b';
select t_eq('the trial is trialing', status, 'trialing'::subscription_status)
  from agency_subscription where agency_id = :'agency_b';

do $$ begin
  begin
    perform start_trial(current_setting('test.agency_b')::uuid, 'scale', 14);
    raise notice 'FAIL  a second trial was allowed';
  exception when others then
    raise notice 'PASS  a second trial is refused';
  end;
end $$;

-- A member is not an owner.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  begin
    perform start_trial(current_setting('test.agency')::uuid, 'studio', 14);
    raise notice 'FAIL  a member started a trial';
  exception when others then
    raise notice 'PASS  a member cannot start a trial';
  end;
end $$;

-- ------------------------------------------------------ tenant isolation
select t_eq('a member sees only their own subscription', count(*), 1::bigint)
  from agency_subscription;
select t_eq('plan_usage refuses another agency', count(*), 0::bigint)
  from plan_usage(:'agency_b');
select t_eq('plan_usage works for your own', count(*), 1::bigint)
  from plan_usage(:'agency_a');

reset role;
