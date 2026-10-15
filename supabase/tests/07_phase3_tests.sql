-- Behaviour tests for 0007_reports.sql, 0008_media_plans.sql and 0009_hr_leave.sql.
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
  ('33333333-3333-3333-3333-333333333333', 'free-a@test.in',   '{"full_name":"Freelancer A"}'),
  ('99999999-9999-9999-9999-999999999991', 'priya@clienta.in', '{}'),
  ('44444444-4444-4444-4444-444444444444', 'owner-b@test.in',  '{"full_name":"Owner B"}');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select create_agency('Agency A') as agency_a \gset
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select create_agency('Agency B') as agency_b \gset

insert into memberships (agency_id, user_id, role) values
  (:'agency_a', '22222222-2222-2222-2222-222222222222', 'member'),
  (:'agency_a', '33333333-3333-3333-3333-333333333333', 'freelancer');

insert into clients (id, agency_id, name, state_code) values
  ('aaaaaaaa-0000-0000-0000-000000000001', :'agency_a', 'Report Client', '27'),
  ('bbbbbbbb-0000-0000-0000-000000000001', :'agency_b', 'B Client', '27');

insert into client_contacts (agency_id, client_id, name, email, portal_enabled) values
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', 'Priya', 'priya@clienta.in', true);

-- Content: two published in May, one scheduled in June, one awaiting the client.
insert into content_items (id, agency_id, client_id, title, status, scheduled_date, published_url, platforms) values
  ('dd000000-0000-0000-0000-000000000001', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'May reel', 'published', '2026-05-10', 'https://instagram.com/p/1', '{Instagram}'),
  ('dd000000-0000-0000-0000-000000000002', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'May carousel', 'published', '2026-05-20', 'https://instagram.com/p/2', '{Instagram,Facebook}'),
  ('dd000000-0000-0000-0000-000000000003', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'June teaser', 'scheduled', '2026-06-05', null, '{Instagram}'),
  ('dd000000-0000-0000-0000-000000000004', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Waiting on client', 'client_approval', '2026-06-10', null, '{LinkedIn}'),
  ('dd000000-0000-0000-0000-000000000005', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Internal draft', 'idea', '2026-05-25', null, '{Instagram}');

insert into content_approvals (agency_id, content_item_id, round, decision, decided_at) values
  (:'agency_a', 'dd000000-0000-0000-0000-000000000001', 1, 'changes_requested', '2026-05-06T10:00:00+05:30'),
  (:'agency_a', 'dd000000-0000-0000-0000-000000000001', 2, 'approved', '2026-05-08T10:00:00+05:30');
insert into content_approvals (agency_id, content_item_id, round) values
  (:'agency_a', 'dd000000-0000-0000-0000-000000000004', 1);

insert into tasks (agency_id, client_id, title, status, completed_at) values
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', 'Shoot the reel', 'done', '2026-05-07T18:00:00+05:30'),
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', 'Edit the reel',  'done', '2026-05-09T18:00:00+05:30'),
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', 'June planning',  'todo', null);

insert into expenses (agency_id, client_id, incurred_on, category, description, amount, rebilled, channel) values
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-05-04', 'Ad spend', 'Meta May', 30000, true, 'Meta'),
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-05-18', 'Ad spend', 'Google May', 12000, true, 'Google'),
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-05-22', 'Ad spend', 'Unknown source', 2000, false, null),
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-05-02', 'Stock & assets', 'Not ad spend', 500, false, null);

\echo '=== client reports: build, freeze, and what they never contain ==='

insert into client_reports (id, agency_id, client_id, period_start, period_end, title, created_by) values
  ('c7000000-0000-0000-0000-000000000001', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   '2026-05-01', '2026-05-31', 'May 2026 report', '11111111-1111-1111-1111-111111111111'),
  ('c7000000-0000-0000-0000-000000000002', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   '2026-05-01', '2026-05-31', 'Draft never sent', '11111111-1111-1111-1111-111111111111');

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

select public.build_client_report('c7000000-0000-0000-0000-000000000001') as snap \gset
select t_eq('two posts published in the period',
            (select (snapshot->'counts'->>'published')::int from client_reports
              where id = 'c7000000-0000-0000-0000-000000000001'), 2);
select t_eq('the published list has both',
            (select jsonb_array_length(snapshot->'published') from client_reports
              where id = 'c7000000-0000-0000-0000-000000000001'), 2);
select t_eq('an internal draft is not in the report',
            (select count(*) from client_reports, jsonb_array_elements(snapshot->'published') p
              where id = 'c7000000-0000-0000-0000-000000000001'
                and p->>'title' = 'Internal draft')::int, 0);
select t_eq('upcoming shows only what is after the period',
            (select jsonb_array_length(snapshot->'upcoming') from client_reports
              where id = 'c7000000-0000-0000-0000-000000000001'), 1);
select t_eq('what is waiting on the client is listed',
            (select jsonb_array_length(snapshot->'awaiting_you') from client_reports
              where id = 'c7000000-0000-0000-0000-000000000001'), 1);
select t_eq('tasks completed in the period',
            (select (snapshot->'counts'->>'tasks_done')::int from client_reports
              where id = 'c7000000-0000-0000-0000-000000000001'), 2);
select t_eq('approval rounds decided in the period',
            (select (snapshot->'counts'->>'approval_rounds')::int from client_reports
              where id = 'c7000000-0000-0000-0000-000000000001'), 2);
select t_eq('of which one asked for changes',
            (select (snapshot->'counts'->>'changes_requested')::int from client_reports
              where id = 'c7000000-0000-0000-0000-000000000001'), 1);
select t_eq('ad spend counts only what was rebilled',
            (select (snapshot->>'ad_spend')::numeric from client_reports
              where id = 'c7000000-0000-0000-0000-000000000001'), 42000::numeric);

-- A client-facing document must never carry internal cost data.
select t_eq('the snapshot has no hours, cost or margin keys',
            (select count(*) from client_reports, jsonb_object_keys(snapshot) k
              where id = 'c7000000-0000-0000-0000-000000000001'
                and k in ('hours','labour_cost','cost','margin','cost_rate'))::int, 0);

select public.send_client_report('c7000000-0000-0000-0000-000000000001');
select t_eq('sent', (select status from client_reports where id = 'c7000000-0000-0000-0000-000000000001'),
            'sent'::report_status);

do $$ begin
  perform public.build_client_report('c7000000-0000-0000-0000-000000000001');
  raise notice 'FAIL  a sent report was rebuilt';
exception when others then raise notice 'PASS  a sent report cannot be rebuilt';
end $$;
do $$ begin
  perform public.send_client_report('c7000000-0000-0000-0000-000000000001');
  raise notice 'FAIL  a report was sent twice';
exception when others then raise notice 'PASS  a report cannot be sent twice';
end $$;
do $$ begin
  perform public.send_client_report('c7000000-0000-0000-0000-000000000002');
  raise notice 'FAIL  an unbuilt report was sent';
exception when others then raise notice 'PASS  a report must be built before it is sent';
end $$;

with tampered as (
  update client_reports set summary = 'changed after sending'
   where id = 'c7000000-0000-0000-0000-000000000001' returning 1
)
select t_eq('a sent report cannot be edited', (select count(*) from tampered)::int, 0);

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select t_eq('a freelancer sees no reports', (select count(*) from client_reports)::int, 0);

\echo '=== the portal shows sent reports only ==='

select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999991', false);
select t_eq('the client sees the sent report', (select count(*) from portal_reports)::int, 1);
select t_eq('and not the unsent draft',
            (select count(*) from portal_reports where title = 'Draft never sent')::int, 0);
select t_eq('no direct access to the table', (select count(*) from client_reports)::int, 0);

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select t_eq('another agency sees nothing in the portal view', (select count(*) from portal_reports)::int, 0);

\echo '=== media plans: planned against actual ==='

reset role;
insert into media_plans (id, agency_id, client_id, name, period_start, period_end) values
  ('e8000000-0000-0000-0000-000000000001', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'May–June paid plan', '2026-05-01', '2026-06-30');
-- Entered mid-month on purpose: the trigger must normalise it to the 1st.
insert into media_plan_lines (agency_id, plan_id, channel, month, planned) values
  (:'agency_a', 'e8000000-0000-0000-0000-000000000001', 'Meta',     '2026-05-15', 25000),
  (:'agency_a', 'e8000000-0000-0000-0000-000000000001', 'LinkedIn', '2026-05-01', 10000);

select t_eq('a mid-month date is normalised to the 1st',
            (select month from media_plan_lines
              where plan_id = 'e8000000-0000-0000-0000-000000000001' and channel = 'Meta'), '2026-05-01'::date);

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

select t_eq('Meta: planned 25,000 against 30,000 actual',
            (select actual from media_plan_summary('e8000000-0000-0000-0000-000000000001')
              where channel = 'Meta' and month = '2026-05-01'), 30000.00);
select t_eq('Meta overspend shows as a positive variance',
            (select variance from media_plan_summary('e8000000-0000-0000-0000-000000000001')
              where channel = 'Meta' and month = '2026-05-01'), 5000.00);
select t_eq('LinkedIn was planned but never spent',
            (select actual from media_plan_summary('e8000000-0000-0000-0000-000000000001')
              where channel = 'LinkedIn' and month = '2026-05-01'), 0.00);
select t_eq('underspend shows as a negative variance',
            (select variance from media_plan_summary('e8000000-0000-0000-0000-000000000001')
              where channel = 'LinkedIn' and month = '2026-05-01'), -10000.00);
select t_eq('Google was spent on without being planned',
            (select planned from media_plan_summary('e8000000-0000-0000-0000-000000000001')
              where channel = 'Google' and month = '2026-05-01'), 0.00);
select t_eq('and its spend still shows',
            (select actual from media_plan_summary('e8000000-0000-0000-0000-000000000001')
              where channel = 'Google' and month = '2026-05-01'), 12000.00);
select t_eq('ad spend with no channel is bucketed as unattributed',
            (select actual from media_plan_summary('e8000000-0000-0000-0000-000000000001')
              where channel = 'Unattributed'), 2000.00);
select t_eq('a non-ad-spend expense is not counted as media spend',
            (select count(*) from media_plan_summary('e8000000-0000-0000-0000-000000000001')
              where actual = 500.00)::int, 0);

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select t_eq('a member can read the plan', (select count(*) from media_plans)::int, 1);
do $$ begin
  insert into media_plan_lines (agency_id, plan_id, channel, month, planned)
  values ((select id from agencies where name = 'Agency A'),
          'e8000000-0000-0000-0000-000000000001', 'Sneaky', '2026-05-01', 1);
  raise notice 'FAIL  a member edited a media plan';
exception when others then raise notice 'PASS  a member cannot edit a media plan (%)', sqlstate;
end $$;

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select t_eq('another agency sees no plans', (select count(*) from media_plans)::int, 0);
do $$ begin
  perform public.media_plan_summary('e8000000-0000-0000-0000-000000000001');
  raise notice 'FAIL  another agency read our plan summary';
exception when others then raise notice 'PASS  another agency cannot read our plan summary';
end $$;

\echo '=== leave: nobody approves their own ==='

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select public.request_leave('Casual', '2026-05-18', '2026-05-20', 3, 'Family wedding') as lr1 \gset
select t_eq('the request is pending',
            (select status from leave_requests where id = :'lr1'), 'pending'::leave_status);

do $$ begin
  perform public.request_leave('Casual', '2026-05-19', '2026-05-21', 3, 'Overlapping');
  raise notice 'FAIL  an overlapping request was accepted';
exception when others then raise notice 'PASS  an overlapping request is refused';
end $$;

do $$ begin
  perform public.request_leave('Casual', '2026-06-01', '2026-06-02', 5, 'More days than dates');
  raise notice 'FAIL  more days than the dates cover was accepted';
exception when others then raise notice 'PASS  more days than the dates cover is refused';
end $$;

do $$ begin
  insert into leave_requests (agency_id, user_id, leave_type, from_date, to_date, days)
  values ((select id from agencies where name = 'Agency A'), auth.uid(), 'Casual', '2026-07-01', '2026-07-02', 2);
  raise notice 'FAIL  leave was inserted directly, bypassing the overlap rule';
exception when others then raise notice 'PASS  leave cannot be inserted directly (%)', sqlstate;
end $$;

do $$ begin
  perform public.decide_leave((select id from leave_requests limit 1), 'approved');
  raise notice 'FAIL  a member decided a leave request';
exception when others then raise notice 'PASS  a member cannot decide a leave request';
end $$;

-- The owner files their own request, then tries to approve it.
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.request_leave('Earned', '2026-06-15', '2026-06-16', 2, 'Short break') as lr2 \gset
do $$ begin
  perform public.decide_leave((select id from leave_requests
                                where user_id = '11111111-1111-1111-1111-111111111111' limit 1), 'approved');
  raise notice 'FAIL  the owner approved their own leave';
exception when others then raise notice 'PASS  nobody approves their own leave, owner included';
end $$;

select public.decide_leave(:'lr1', 'approved', 'Enjoy');
select t_eq('the member''s leave is approved',
            (select status from leave_requests where id = :'lr1'), 'approved'::leave_status);
select t_eq('and credited to the approver',
            (select decided_by from leave_requests where id = :'lr1'),
            '11111111-1111-1111-1111-111111111111'::uuid);

do $$ begin
  perform public.decide_leave((select id from leave_requests where status = 'approved' limit 1), 'rejected');
  raise notice 'FAIL  a decided request was decided again';
exception when others then raise notice 'PASS  a decided request cannot be decided again';
end $$;

\echo '=== leave balances ==='

select public.set_leave_allowance('22222222-2222-2222-2222-222222222222', '26-27', 'Casual', 12);
select public.set_leave_allowance('22222222-2222-2222-2222-222222222222', '26-27', 'Casual', 14);
select t_eq('setting an allowance twice updates rather than duplicating',
            (select count(*) from leave_allowances
              where user_id = '22222222-2222-2222-2222-222222222222' and leave_type = 'Casual')::int, 1);
select t_eq('allowance',  (select allowance from leave_balances(
              (select id from agencies where name = 'Agency A'), '26-27')
              where user_id = '22222222-2222-2222-2222-222222222222' and leave_type = 'Casual'), 14.0);
select t_eq('taken counts approved leave only', (select taken from leave_balances(
              (select id from agencies where name = 'Agency A'), '26-27')
              where user_id = '22222222-2222-2222-2222-222222222222' and leave_type = 'Casual'), 3.0);
select t_eq('remaining is allowance less taken', (select remaining from leave_balances(
              (select id from agencies where name = 'Agency A'), '26-27')
              where user_id = '22222222-2222-2222-2222-222222222222' and leave_type = 'Casual'), 11.0);
select t_eq('a pending request is counted separately, not deducted',
            (select pending from leave_balances(
              (select id from agencies where name = 'Agency A'), '26-27')
              where user_id = '11111111-1111-1111-1111-111111111111' and leave_type = 'Earned'), 2.0);

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  perform public.leave_balances((select id from agencies where name = 'Agency A'), '26-27');
  raise notice 'FAIL  a member read everybody''s leave balances';
exception when others then raise notice 'PASS  a member cannot read everybody''s balances';
end $$;
select t_eq('but the team calendar is visible to everyone',
            (select count(*) from leave_requests)::int, 2);

\echo '=== cancelling leave ==='
select public.cancel_leave(:'lr1');
select t_eq('a member can withdraw their own leave',
            (select status from leave_requests where id = :'lr1'), 'cancelled'::leave_status);
-- Reading balances needs a manager, so check this as the owner.
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select t_eq('cancelling returns the days to the balance', (select remaining from leave_balances(
              (select id from agencies where name = 'Agency A'), '26-27')
              where user_id = '22222222-2222-2222-2222-222222222222' and leave_type = 'Casual'), 14.0);

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  perform public.cancel_leave((select id from leave_requests
                                where user_id = '11111111-1111-1111-1111-111111111111' limit 1));
  raise notice 'FAIL  a member cancelled somebody else''s leave';
exception when others then raise notice 'PASS  a member cannot cancel somebody else''s leave';
end $$;

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select t_eq('another agency sees no leave at all', (select count(*) from leave_requests)::int, 0);

reset role;
