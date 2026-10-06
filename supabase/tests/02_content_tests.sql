-- Behaviour tests for 0002_content.sql: tenant isolation, freelancer scoping,
-- and the two approval RPCs. Run after 0001 + 0002 against the mocked auth.
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
-- Re-runnable: agencies cascade to every business table, auth.users to profiles.
delete from agencies;
delete from auth.users;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@test.in',  '{"full_name":"Owner A"}'),
  ('22222222-2222-2222-2222-222222222222', 'member-a@test.in', '{"full_name":"Member A"}'),
  ('33333333-3333-3333-3333-333333333333', 'free-a@test.in',   '{"full_name":"Freelancer A"}'),
  ('44444444-4444-4444-4444-444444444444', 'owner-b@test.in',  '{"full_name":"Owner B"}');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select create_agency('Agency A') as agency_a \gset
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select create_agency('Agency B') as agency_b \gset

insert into memberships (agency_id, user_id, role) values
  (:'agency_a', '22222222-2222-2222-2222-222222222222', 'member'),
  (:'agency_a', '33333333-3333-3333-3333-333333333333', 'freelancer');

insert into clients (id, agency_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', :'agency_a', 'Client A1'),
  ('bbbbbbbb-0000-0000-0000-000000000001', :'agency_b', 'Client B1');

insert into content_items (id, agency_id, client_id, title, assignee_id, scheduled_date, max_revisions) values
  ('cccccccc-0000-0000-0000-000000000001', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Diwali reel',    '33333333-3333-3333-3333-333333333333', current_date + 3, 2),
  ('cccccccc-0000-0000-0000-000000000002', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Festive carousel','22222222-2222-2222-2222-222222222222', current_date + 5, 2),
  ('cccccccc-0000-0000-0000-000000000003', :'agency_b', 'bbbbbbbb-0000-0000-0000-000000000001',
   'B company post',  null, current_date + 1, null);

\echo '=== tenant isolation + role scoping ==='

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select t_eq('owner A sees only agency A content', (select count(*) from content_items)::int, 2);

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select t_eq('owner B sees only agency B content', (select count(*) from content_items)::int, 1);
select t_eq('owner B cannot see A approvals',     (select count(*) from content_approvals)::int, 0);

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select t_eq('member A (staff) sees all agency A content', (select count(*) from content_items)::int, 2);

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select t_eq('freelancer sees only their own item', (select count(*) from content_items)::int, 1);
select t_eq('freelancer sees the right item',
            (select title from content_items), 'Diwali reel'::text);

\echo '=== writes are gated by role ==='

do $$ begin
  insert into content_items (agency_id, client_id, title)
  values ((select id from agencies limit 1), 'aaaaaaaa-0000-0000-0000-000000000001', 'Sneaky');
  raise notice 'FAIL  freelancer blocked from creating content -> insert succeeded';
exception when others then raise notice 'PASS  freelancer blocked from creating content (%)', sqlstate;
end $$;

update content_items set status = 'internal_review' where id = 'cccccccc-0000-0000-0000-000000000001';
select t_eq('freelancer can advance their own item',
            (select status from content_items where id = 'cccccccc-0000-0000-0000-000000000001'),
            'internal_review'::content_status);

update content_items set status = 'published' where id = 'cccccccc-0000-0000-0000-000000000002';
select t_eq('freelancer cannot touch someone else''s item (rows changed)',
            (select count(*) from content_items where id = 'cccccccc-0000-0000-0000-000000000002'
              and status = 'published')::int, 0);

\echo '=== approval round 1: changes requested ==='

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select request_content_approval('cccccccc-0000-0000-0000-000000000001') as appr1 \gset
select t_eq('item moves to client_approval',
            (select status from content_items where id = 'cccccccc-0000-0000-0000-000000000001'),
            'client_approval'::content_status);
select t_eq('round 1 opened', (select round from content_approvals where id = :'appr1'), 1);

select request_content_approval('cccccccc-0000-0000-0000-000000000001') as appr1b \gset
select t_eq('re-requesting reuses the open round', :'appr1b'::uuid, :'appr1'::uuid);
select t_eq('still only one approval row', (select count(*) from content_approvals)::int, 1);

select decide_content_approval(:'appr1', 'changes_requested', 'Logo too small on frame 2');
select t_eq('changes requested sets status',
            (select status from content_items where id = 'cccccccc-0000-0000-0000-000000000001'),
            'changes_requested'::content_status);
select t_eq('changes requested counts a revision',
            (select revision_count from content_items where id = 'cccccccc-0000-0000-0000-000000000001'), 1);
select t_eq('decision is stamped',
            (select decided_at is not null and on_behalf from content_approvals where id = :'appr1'), true);

do $$ begin
  perform decide_content_approval('00000000-0000-0000-0000-000000000000'::uuid, 'approved');
  raise notice 'FAIL  deciding an unknown approval -> no error';
exception when others then raise notice 'PASS  deciding an unknown approval is rejected';
end $$;

\echo '=== approval round 2: approved ==='

select request_content_approval('cccccccc-0000-0000-0000-000000000001') as appr2 \gset
select t_eq('a new request opens round 2', (select round from content_approvals where id = :'appr2'), 2);

select decide_content_approval(:'appr2', 'approved', 'Go ahead');
select t_eq('approved + scheduled_date set -> scheduled',
            (select status from content_items where id = 'cccccccc-0000-0000-0000-000000000001'),
            'scheduled'::content_status);
select t_eq('approving does not count a revision',
            (select revision_count from content_items where id = 'cccccccc-0000-0000-0000-000000000001'), 1);

do $$ begin
  perform decide_content_approval(
    (select id from content_approvals where round = 2 limit 1), 'approved');
  raise notice 'FAIL  double-deciding a round -> no error';
exception when others then raise notice 'PASS  double-deciding a round is rejected';
end $$;

\echo '=== approval with no scheduled date, and cross-tenant attempts ==='

update content_items set scheduled_date = null where id = 'cccccccc-0000-0000-0000-000000000002';
select request_content_approval('cccccccc-0000-0000-0000-000000000002') as appr3 \gset
select decide_content_approval(:'appr3', 'approved');
select t_eq('approved with no date -> approved (not scheduled)',
            (select status from content_items where id = 'cccccccc-0000-0000-0000-000000000002'),
            'approved'::content_status);

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
do $$ begin
  perform request_content_approval('cccccccc-0000-0000-0000-000000000001');
  raise notice 'FAIL  other agency can request approval -> no error';
exception when others then raise notice 'PASS  other agency cannot request approval (%)', sqlerrm;
end $$;

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
do $$ begin
  perform request_content_approval('cccccccc-0000-0000-0000-000000000001');
  raise notice 'FAIL  freelancer can request approval -> no error';
exception when others then raise notice 'PASS  freelancer cannot request approval (%)', sqlerrm;
end $$;

\echo '=== published_at trigger and the approval check constraint ==='

reset role;
update content_items set status = 'published' where id = 'cccccccc-0000-0000-0000-000000000001';
select t_eq('published stamps published_at',
            (select published_at is not null from content_items where id = 'cccccccc-0000-0000-0000-000000000001'), true);
update content_items set status = 'scheduled' where id = 'cccccccc-0000-0000-0000-000000000001';
select t_eq('un-publishing clears published_at',
            (select published_at from content_items where id = 'cccccccc-0000-0000-0000-000000000001'), null::timestamptz);

do $$ begin
  insert into content_approvals (agency_id, content_item_id, decision)
  values ((select agency_id from content_items limit 1), 'cccccccc-0000-0000-0000-000000000001', 'approved');
  raise notice 'FAIL  decided-without-timestamp allowed';
exception when check_violation then raise notice 'PASS  decided-without-timestamp rejected by constraint';
end $$;

\echo '=== comments ==='

set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
insert into content_comments (agency_id, content_item_id, author_id, body, visible_to_client)
values (:'agency_a', 'cccccccc-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'Reshot the hero frame', false);
select t_eq('member can comment', (select count(*) from content_comments)::int, 1);

do $$ begin
  insert into content_comments (agency_id, content_item_id, author_id, body)
  values ((select agency_id from content_items limit 1), 'cccccccc-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111', 'Impersonated');
  raise notice 'FAIL  commenting as another user allowed';
exception when others then raise notice 'PASS  commenting as another user blocked (%)', sqlstate;
end $$;

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select t_eq('other agency cannot read comments', (select count(*) from content_comments)::int, 0);

reset role;
