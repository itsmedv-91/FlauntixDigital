-- Behaviour tests for 0006_profitability.sql. These check the margin maths to
-- the rupee, and the two decisions that most affect the numbers: cost rates are
-- snapshotted, and non-billable client time is still a cost.
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
  ('66666666-6666-6666-6666-666666666666', 'member2-a@test.in', '{"full_name":"Unpriced Person"}'),
  ('33333333-3333-3333-3333-333333333333', 'free-a@test.in',    '{"full_name":"Freelancer A"}'),
  ('99999999-9999-9999-9999-999999999991', 'priya@clienta.in',  '{}'),
  ('44444444-4444-4444-4444-444444444444', 'owner-b@test.in',   '{"full_name":"Owner B"}');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select create_agency('Agency A') as agency_a \gset
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select create_agency('Agency B') as agency_b \gset

insert into memberships (agency_id, user_id, role, hourly_cost) values
  (:'agency_a', '22222222-2222-2222-2222-222222222222', 'member', 1000),
  -- Deliberately no hourly cost: their time must show up as unpriced, not free.
  (:'agency_a', '66666666-6666-6666-6666-666666666666', 'member', null),
  (:'agency_a', '33333333-3333-3333-3333-333333333333', 'freelancer', 500);
update memberships set hourly_cost = 2000
 where agency_id = :'agency_a' and user_id = '11111111-1111-1111-1111-111111111111';

update agencies set state_code = '27', gstin = '27AAPFU0939F1ZV', invoice_prefix = 'FLX'
 where id = :'agency_a';

insert into clients (id, agency_id, name, state_code, monthly_retainer) values
  ('aaaaaaaa-0000-0000-0000-000000000001', :'agency_a', 'Profitable Client', '27', 50000),
  ('aaaaaaaa-0000-0000-0000-000000000002', :'agency_a', 'Unbilled Client',   '27', null),
  ('aaaaaaaa-0000-0000-0000-000000000003', :'agency_a', 'Boundary Client',   '27', null),
  ('bbbbbbbb-0000-0000-0000-000000000001', :'agency_b', 'Agency B Client',   '27', 99999);

insert into client_contacts (agency_id, client_id, name, email, portal_enabled) values
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', 'Priya', 'priya@clienta.in', true);

-- Time in May 2026. 2h of the owner at 2000, 5h billable + 1h NON-billable of
-- the member at 1000 => 8h and 10,000 of labour cost.
insert into time_entries (agency_id, user_id, client_id, started_at, ended_at, minutes, billable) values
  (:'agency_a', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
   '2026-05-05T10:00:00+05:30', '2026-05-05T12:00:00+05:30', 120, true),
  (:'agency_a', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001',
   '2026-05-06T10:00:00+05:30', '2026-05-06T15:00:00+05:30', 300, true),
  (:'agency_a', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001',
   '2026-05-07T10:00:00+05:30', '2026-05-07T11:00:00+05:30', 60, false),
  -- Unpriced person, on the client with no invoice.
  (:'agency_a', '66666666-6666-6666-6666-666666666666', 'aaaaaaaa-0000-0000-0000-000000000002',
   '2026-05-08T10:00:00+05:30', '2026-05-08T12:00:00+05:30', 120, true),
  -- Internal time: overhead, not a client cost.
  (:'agency_a', '11111111-1111-1111-1111-111111111111', null,
   '2026-05-09T10:00:00+05:30', '2026-05-09T11:00:00+05:30', 60, false),
  -- IST boundary pair: 20:00 UTC on 30 Apr is 01:30 IST on 1 May, so it is May.
  (:'agency_a', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000003',
   '2026-04-30T20:00:00Z', '2026-04-30T21:00:00Z', 60, true),
  -- 19:00 UTC on 31 May is 00:30 IST on 1 June, so it is NOT May.
  (:'agency_a', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000003',
   '2026-05-31T19:00:00Z', '2026-05-31T20:00:00Z', 60, true);

-- Agency B logs time too; none of it may appear in Agency A's report.
insert into time_entries (agency_id, user_id, client_id, started_at, minutes, billable) values
  (:'agency_b', '44444444-4444-4444-4444-444444444444', 'bbbbbbbb-0000-0000-0000-000000000001',
   '2026-05-05T10:00:00+05:30', 600, true);

insert into expenses (agency_id, client_id, incurred_on, category, description, amount, rebilled) values
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-05-03', 'Ad spend',
   'Meta ad spend fronted for the client', 20000, true),
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-05-04', 'Stock & assets',
   'Stock photography', 1500, false),
  (:'agency_a', null, '2026-05-02', 'Software & tools', 'Design tool subscription', 3000, false);

-- An issued invoice: 50,000 retainer + 20,000 ad spend recovery, 18% GST.
insert into invoices (id, agency_id, client_id, issue_date, supplier_state_code, place_of_supply_code)
values ('ff000000-0000-0000-0000-000000000001', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
        '2026-05-10', '27', '27');
insert into invoice_lines (agency_id, invoice_id, description, quantity, unit_price, gst_rate, position) values
  (:'agency_a', 'ff000000-0000-0000-0000-000000000001', 'May retainer', 1, 50000, 18, 1),
  (:'agency_a', 'ff000000-0000-0000-0000-000000000001', 'Ad spend recovery', 1, 20000, 18, 2);

-- A draft and a cancelled invoice, neither of which is revenue.
insert into invoices (id, agency_id, client_id, issue_date, supplier_state_code, place_of_supply_code)
values ('ff000000-0000-0000-0000-000000000002', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
        '2026-05-20', '27', '27'),
       ('ff000000-0000-0000-0000-000000000003', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
        '2026-05-21', '27', '27');
insert into invoice_lines (agency_id, invoice_id, description, quantity, unit_price, gst_rate) values
  (:'agency_a', 'ff000000-0000-0000-0000-000000000002', 'Draft work', 1, 99999, 18),
  (:'agency_a', 'ff000000-0000-0000-0000-000000000003', 'To be cancelled', 1, 88888, 18);

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select issue_invoice('ff000000-0000-0000-0000-000000000001', '2026-05-10') as n1 \gset
select issue_invoice('ff000000-0000-0000-0000-000000000003', '2026-05-21') as n3 \gset
select cancel_invoice('ff000000-0000-0000-0000-000000000003', 'Raised in error');
reset role;

\echo '=== cost rates are stamped on insert, not joined live ==='
select t_eq('owner time stamped at 2000',
            (select distinct cost_rate from time_entries
              where user_id = '11111111-1111-1111-1111-111111111111' and client_id is not null), 2000.00);
select t_eq('member time stamped at 1000',
            (select distinct cost_rate from time_entries
              where user_id = '22222222-2222-2222-2222-222222222222'), 1000.00);
select t_eq('unpriced person has no rate',
            (select cost_rate from time_entries where user_id = '66666666-6666-6666-6666-666666666666'), null::numeric);

\echo '=== per-client margin ==='

set role authenticated;
select t_eq('revenue excludes GST (taxable value, not the invoice total)',
            (select revenue from client_profitability(:'agency_a', '2026-05-01', '2026-05-31')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 70000.00);
select t_eq('labour cost includes the non-billable hour',
            (select labour_cost from client_profitability(:'agency_a', '2026-05-01', '2026-05-31')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 10000.00);
select t_eq('hours are all client hours',
            (select hours from client_profitability(:'agency_a', '2026-05-01', '2026-05-31')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 8.00);
select t_eq('billable hours exclude the non-billable one',
            (select billable_hours from client_profitability(:'agency_a', '2026-05-01', '2026-05-31')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 7.00);
select t_eq('expenses total both lines',
            (select expense_cost from client_profitability(:'agency_a', '2026-05-01', '2026-05-31')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 21500.00);
select t_eq('rebilled expense reported separately',
            (select rebilled_expense from client_profitability(:'agency_a', '2026-05-01', '2026-05-31')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 20000.00);
select t_eq('total cost is labour + expenses',
            (select total_cost from client_profitability(:'agency_a', '2026-05-01', '2026-05-31')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 31500.00);
select t_eq('margin is revenue - cost',
            (select margin from client_profitability(:'agency_a', '2026-05-01', '2026-05-31')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 38500.00);
select t_eq('margin percent',
            (select margin_pct from client_profitability(:'agency_a', '2026-05-01', '2026-05-31')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 55.0);
select t_eq('effective hourly rate is revenue over hours',
            (select effective_rate from client_profitability(:'agency_a', '2026-05-01', '2026-05-31')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 8750.00);
select t_eq('expected retainer is the monthly figure for one month',
            (select expected_retainer from client_profitability(:'agency_a', '2026-05-01', '2026-05-31')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 50000.00);
select t_eq('a quarter counts three months of retainer',
            (select expected_retainer from client_profitability(:'agency_a', '2026-04-01', '2026-06-30')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 150000.00);

select t_eq('a draft invoice is not revenue, and nor is a cancelled one',
            (select revenue from client_profitability(:'agency_a', '2026-05-01', '2026-05-31')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 70000.00);

\echo '=== unpriced labour is surfaced, never treated as free ==='
select t_eq('unpriced hours are reported',
            (select unpriced_hours from client_profitability(:'agency_a', '2026-05-01', '2026-05-31')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 2.00);
select t_eq('and their labour cost is zero, which is why the warning matters',
            (select labour_cost from client_profitability(:'agency_a', '2026-05-01', '2026-05-31')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 0.00);
select t_eq('margin percent is null when there is no revenue',
            (select margin_pct from client_profitability(:'agency_a', '2026-05-01', '2026-05-31')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000002'), null::numeric);
select t_eq('the unpriced contributor is named',
            (select full_name from unpriced_contributors(:'agency_a', '2026-05-01', '2026-05-31')),
            'Unpriced Person'::text);
select t_eq('with their hours',
            (select hours from unpriced_contributors(:'agency_a', '2026-05-01', '2026-05-31')), 2.00);

\echo '=== IST decides which month an entry falls in ==='
select t_eq('20:00 UTC on 30 Apr is 1 May in IST, so it counts in May',
            (select hours from client_profitability(:'agency_a', '2026-05-01', '2026-05-31')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000003'), 1.00);
select t_eq('19:00 UTC on 31 May is 1 June in IST, so it counts in June',
            (select hours from client_profitability(:'agency_a', '2026-06-01', '2026-06-30')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000003'), 1.00);
select t_eq('and April shows neither of them',
            (select count(*) from client_profitability(:'agency_a', '2026-04-01', '2026-04-30')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000003')::int, 0);

\echo '=== the agency bottom line ==='
select t_eq('agency revenue',        (select revenue       from agency_profitability(:'agency_a', '2026-05-01', '2026-05-31')), 70000.00);
-- 10,000 on the main client + 1,000 for the boundary client's May hour + 0 for
-- the unpriced person, plus 21,500 of client expenses.
select t_eq('direct cost',           (select direct_cost   from agency_profitability(:'agency_a', '2026-05-01', '2026-05-31')), 32500.00);
select t_eq('overhead cost is internal time plus internal expenses',
                                     (select overhead_cost from agency_profitability(:'agency_a', '2026-05-01', '2026-05-31')), 5000.00);
select t_eq('overhead hours',        (select overhead_hours from agency_profitability(:'agency_a', '2026-05-01', '2026-05-31')), 1.00);
-- 70,000 - 32,500 direct - 5,000 overhead.
select t_eq('agency margin',         (select margin        from agency_profitability(:'agency_a', '2026-05-01', '2026-05-31')), 32500.00);
select t_eq('agency margin percent', (select margin_pct    from agency_profitability(:'agency_a', '2026-05-01', '2026-05-31')), 46.4);
select t_eq('client hours exclude overhead',
                                     (select client_hours  from agency_profitability(:'agency_a', '2026-05-01', '2026-05-31')), 11.00);

\echo '=== a pay rise must not rewrite last month''s margin ==='
reset role;
update memberships set hourly_cost = 5000
 where agency_id = :'agency_a' and user_id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
select t_eq('labour cost unchanged after the raise',
            (select labour_cost from client_profitability(:'agency_a', '2026-05-01', '2026-05-31')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 10000.00);
select t_eq('margin unchanged after the raise',
            (select margin from client_profitability(:'agency_a', '2026-05-01', '2026-05-31')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 38500.00);
-- New time logged after the raise picks up the new rate.
reset role;
insert into time_entries (agency_id, user_id, client_id, started_at, minutes, billable) values
  (:'agency_a', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001',
   '2026-06-02T10:00:00+05:30', 60, true);
select t_eq('time logged after the raise is stamped at the new rate',
            (select cost_rate from time_entries where started_at = '2026-06-02T10:00:00+05:30'), 5000.00);
set role authenticated;
select t_eq('and June costs the new rate',
            (select labour_cost from client_profitability(:'agency_a', '2026-06-01', '2026-06-30')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 5000.00);

\echo '=== setting hourly cost, including the owner''s ==='

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- The gap this RPC exists to close: memberships_update refuses owner rows.
select t_eq('a direct update cannot price the owner',
            (select count(*) from (
               select 1 from memberships
                where user_id = '11111111-1111-1111-1111-111111111111' and hourly_cost = 2000) x)::int, 1);
with tried as (
  update memberships set hourly_cost = 9999
   where user_id = '11111111-1111-1111-1111-111111111111' returning 1
)
select t_eq('a direct update of the owner changes nothing', (select count(*) from tried)::int, 0);

select public.set_hourly_cost('11111111-1111-1111-1111-111111111111', 2500);
select t_eq('the RPC can price the owner',
            (select hourly_cost from memberships
              where user_id = '11111111-1111-1111-1111-111111111111'), 2500.00);

select public.set_hourly_cost('66666666-6666-6666-6666-666666666666', 800);
select t_eq('and the previously unpriced member',
            (select hourly_cost from memberships
              where user_id = '66666666-6666-6666-6666-666666666666'), 800.00);
select t_eq('pricing someone changes no past cost rate',
            (select labour_cost from client_profitability(
               (select id from agencies where name = 'Agency A'), '2026-05-01', '2026-05-31')
              where client_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 0.00);
select t_eq('it is written to the activity log',
            (select count(*) from activity_log where action = 'hourly_cost_set')::int, 2);

do $$ begin
  perform public.set_hourly_cost('11111111-1111-1111-1111-111111111111', -5);
  raise notice 'FAIL  a negative hourly cost was accepted';
exception when others then raise notice 'PASS  a negative hourly cost is refused';
end $$;

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  perform public.set_hourly_cost('11111111-1111-1111-1111-111111111111', 1);
  raise notice 'FAIL  a member set somebody''s hourly cost';
exception when others then raise notice 'PASS  a member cannot set an hourly cost';
end $$;

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
do $$ begin
  perform public.set_hourly_cost('22222222-2222-2222-2222-222222222222', 1);
  raise notice 'FAIL  another agency set our member''s cost';
exception when others then raise notice 'PASS  another agency cannot set our member''s cost';
end $$;

-- Narrow by construction: it touches hourly_cost and nothing else.
reset role;
select t_eq('the RPC did not change anybody''s role',
            (select role from memberships where user_id = '22222222-2222-2222-2222-222222222222'),
            'member'::member_role);
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

\echo '=== tenant isolation and who may see costs ==='
select t_eq('agency A''s report never includes agency B''s hours',
            (select count(*) from client_profitability(:'agency_a', '2026-05-01', '2026-05-31')
              where client_name = 'Agency B Client')::int, 0);
do $$ begin
  perform agency_profitability((select id from agencies where name = 'Agency B'), '2026-05-01', '2026-05-31');
  raise notice 'FAIL  agency A read agency B''s bottom line';
exception when others then raise notice 'PASS  agency A cannot read agency B''s bottom line';
end $$;

-- Agency B's own owner sees only agency B's hours.
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select t_eq('agency B sees only its own numbers',
            (select client_hours from agency_profitability(:'agency_b', '2026-05-01', '2026-05-31')), 10.00);

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select t_eq('a member sees no expenses', (select count(*) from expenses)::int, 0);
do $$ begin
  perform client_profitability((select id from agencies where name = 'Agency A'), '2026-05-01', '2026-05-31');
  raise notice 'FAIL  a member ran the profitability report';
exception when others then raise notice 'PASS  a member cannot run the profitability report';
end $$;

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
do $$ begin
  perform agency_profitability((select id from agencies where name = 'Agency A'), '2026-05-01', '2026-05-31');
  raise notice 'FAIL  a freelancer ran the agency report';
exception when others then raise notice 'PASS  a freelancer cannot run the agency report';
end $$;

select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999991', false);
select t_eq('a portal client sees no expenses', (select count(*) from expenses)::int, 0);
do $$ begin
  perform client_profitability((select id from agencies where name = 'Agency A'), '2026-05-01', '2026-05-31');
  raise notice 'FAIL  a portal client ran the report';
exception when others then raise notice 'PASS  a portal client cannot run the report';
end $$;

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
do $$ begin
  perform client_profitability((select id from agencies where name = 'Agency A'), '2026-05-01', '2026-05-31');
  raise notice 'FAIL  another agency ran our client report';
exception when others then raise notice 'PASS  another agency cannot run our client report';
end $$;

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  perform client_profitability((select id from agencies where name = 'Agency A'), '2026-05-31', '2026-05-01');
  raise notice 'FAIL  a backwards date range was accepted';
exception when others then raise notice 'PASS  a backwards date range is refused';
end $$;

reset role;
