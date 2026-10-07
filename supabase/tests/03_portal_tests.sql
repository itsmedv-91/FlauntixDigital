-- Behaviour tests for 0003_portal.sql. The important ones are the leak tests:
-- a portal user is `authenticated` like anyone else, so the only thing standing
-- between them and another client's data is RLS plus the view definitions.
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
  ('99999999-9999-9999-9999-999999999991', 'priya@clienta.in',  '{}'),
  ('99999999-9999-9999-9999-999999999992', 'raj@clientb.in',    '{}'),
  ('99999999-9999-9999-9999-999999999993', 'nobody@random.in',  '{}'),
  ('44444444-4444-4444-4444-444444444444', 'owner-b@test.in',   '{"full_name":"Owner B"}');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select create_agency('Agency A') as agency_a \gset
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select create_agency('Agency B') as agency_b \gset

insert into clients (id, agency_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', :'agency_a', 'Client A1'),
  ('aaaaaaaa-0000-0000-0000-000000000002', :'agency_a', 'Client A2'),
  ('bbbbbbbb-0000-0000-0000-000000000001', :'agency_b', 'Client B1');

-- Priya is portal-enabled on Client A1. Raj is a contact of Client A2 but NOT
-- portal-enabled. Client B1's contact belongs to the other agency entirely.
insert into client_contacts (id, agency_id, client_id, name, email, is_primary, portal_enabled) values
  ('cc000000-0000-0000-0000-000000000001', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Priya Nair', 'priya@clienta.in', true, true),
  ('cc000000-0000-0000-0000-000000000002', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000002',
   'Raj Mehta', 'raj@clientb.in', true, false),
  ('cc000000-0000-0000-0000-000000000003', :'agency_b', 'bbbbbbbb-0000-0000-0000-000000000001',
   'B Contact', 'bcontact@clientb.in', true, true);

-- Content for Client A1 across the status range, plus one for A2 and one for B1.
insert into content_items (id, agency_id, client_id, title, caption, notes, status, scheduled_date, max_revisions) values
  ('dd000000-0000-0000-0000-000000000001', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Shared: awaiting approval', 'Buy our thing', 'INTERNAL: client is slow to reply', 'client_approval', current_date + 3, 2),
  ('dd000000-0000-0000-0000-000000000002', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Secret draft', 'wip', 'INTERNAL: do not send yet', 'idea', current_date + 5, 2),
  ('dd000000-0000-0000-0000-000000000003', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Internal review only', 'wip2', 'INTERNAL', 'internal_review', current_date + 6, 2),
  ('dd000000-0000-0000-0000-000000000004', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Already published', 'live', null, 'published', current_date - 2, 2),
  ('dd000000-0000-0000-0000-000000000005', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000002',
   'Other client of same agency', 'x', null, 'client_approval', current_date + 1, null),
  ('dd000000-0000-0000-0000-000000000006', :'agency_b', 'bbbbbbbb-0000-0000-0000-000000000001',
   'Other agency entirely', 'y', null, 'client_approval', current_date + 1, null);

-- An open approval round on the shared item, and one on each foreign item.
insert into content_approvals (id, agency_id, content_item_id, round) values
  ('ee000000-0000-0000-0000-000000000001', :'agency_a', 'dd000000-0000-0000-0000-000000000001', 1),
  ('ee000000-0000-0000-0000-000000000005', :'agency_a', 'dd000000-0000-0000-0000-000000000005', 1),
  ('ee000000-0000-0000-0000-000000000006', :'agency_b', 'dd000000-0000-0000-0000-000000000006', 1);

-- One internal comment and one client-visible comment on the shared item.
insert into content_comments (agency_id, content_item_id, author_id, body, visible_to_client) values
  (:'agency_a', 'dd000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'INTERNAL: upsell them a reel', false),
  (:'agency_a', 'dd000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Here is the first cut for your review', true);

\echo '=== the portal user sees their own stuff through the views ==='

set role authenticated;
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999991', false);

select t_eq('portal_me resolves the contact', (select count(*) from portal_me)::int, 1);
select t_eq('portal_me names the contact',    (select name from portal_me), 'Priya Nair'::text);
select t_eq('portal_me names the agency',     (select agency_name from portal_me), 'Agency A'::text);
select t_eq('is_portal_user() is true',       public.is_portal_user(), true);

select t_eq('portal_content shows only shared statuses', (select count(*) from portal_content)::int, 2);
select t_eq('portal_content hides the draft',
            (select count(*) from portal_content where title = 'Secret draft')::int, 0);
select t_eq('portal_content hides internal review',
            (select count(*) from portal_content where title = 'Internal review only')::int, 0);
select t_eq('portal_content hides another client of the same agency',
            (select count(*) from portal_content where title = 'Other client of same agency')::int, 0);
select t_eq('portal_content hides another agency',
            (select count(*) from portal_content where title = 'Other agency entirely')::int, 0);

\echo '=== internal notes and internal comments never reach the client ==='

select t_eq('portal_content has no notes column',
            (select count(*) from information_schema.columns
              where table_name = 'portal_content' and column_name = 'notes')::int, 0);
select t_eq('portal_comments shows only client-visible ones',
            (select count(*) from portal_comments)::int, 1);
select t_eq('portal_comments shows the right one',
            (select body from portal_comments), 'Here is the first cut for your review'::text);
select t_eq('portal_approvals scoped to visible items', (select count(*) from portal_approvals)::int, 1);

\echo '=== direct table access is refused (the real leak test) ==='

select t_eq('cannot read content_items directly',     (select count(*) from content_items)::int, 0);
select t_eq('cannot read content_comments directly',  (select count(*) from content_comments)::int, 0);
select t_eq('cannot read content_approvals directly', (select count(*) from content_approvals)::int, 0);
select t_eq('cannot read clients directly',           (select count(*) from clients)::int, 0);
select t_eq('cannot read tasks',                      (select count(*) from tasks)::int, 0);
select t_eq('cannot read leads',                      (select count(*) from leads)::int, 0);
select t_eq('cannot read credentials',                (select count(*) from credentials)::int, 0);
select t_eq('cannot read time_entries',               (select count(*) from time_entries)::int, 0);
select t_eq('cannot read messages',                   (select count(*) from messages)::int, 0);
select t_eq('cannot read memberships',                (select count(*) from memberships)::int, 0);
select t_eq('cannot read activity_log',               (select count(*) from activity_log)::int, 0);
select t_eq('sees only their own contact row',        (select count(*) from client_contacts)::int, 1);
select t_eq('has no membership at all',
            (select count(*) from memberships m where m.user_id = auth.uid())::int, 0);

do $$ begin
  insert into content_comments (agency_id, content_item_id, author_id, body, visible_to_client)
  values ((select id from agencies limit 1), 'dd000000-0000-0000-0000-000000000001',
          auth.uid(), 'sneaking in', true);
  raise notice 'FAIL  portal user blocked from writing comments directly -> insert succeeded';
exception when others then raise notice 'PASS  portal user blocked from writing comments directly (%)', sqlstate;
end $$;

do $$ begin
  update content_items set status = 'published' where id = 'dd000000-0000-0000-0000-000000000001';
  if (select count(*) from content_items where status = 'published'
        and id = 'dd000000-0000-0000-0000-000000000001') > 0 then
    raise notice 'FAIL  portal user changed a content status directly';
  else
    raise notice 'PASS  portal user cannot change content directly';
  end if;
end $$;

\echo '=== claim_portal_access binds the auth user ==='

select t_eq('claim stamps one contact', public.claim_portal_access(), 1);
reset role;
select t_eq('user_id now set',
            (select user_id from client_contacts where id = 'cc000000-0000-0000-0000-000000000001'),
            '99999999-9999-9999-9999-999999999991'::uuid);
select t_eq('last_portal_login stamped',
            (select last_portal_login is not null from client_contacts
              where id = 'cc000000-0000-0000-0000-000000000001'), true);
set role authenticated;

\echo '=== a contact who is not portal-enabled gets nothing ==='

select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999992', false);
select t_eq('disabled contact: no portal_me',    (select count(*) from portal_me)::int, 0);
select t_eq('disabled contact: no content',      (select count(*) from portal_content)::int, 0);
select t_eq('disabled contact: not a portal user', public.is_portal_user(), false);
select t_eq('disabled contact: claim touches nothing', public.claim_portal_access(), 0);

select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999993', false);
select t_eq('stranger: no portal_me',  (select count(*) from portal_me)::int, 0);
select t_eq('stranger: no content',    (select count(*) from portal_content)::int, 0);

\echo '=== the client decides their own approval ==='

select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999991', false);

do $$ begin
  perform public.portal_decide_approval('ee000000-0000-0000-0000-000000000001', 'changes_requested', '   ');
  raise notice 'FAIL  changes_requested with no comment -> no error';
exception when others then raise notice 'PASS  changes_requested needs a comment';
end $$;

select public.portal_decide_approval('ee000000-0000-0000-0000-000000000001', 'changes_requested',
                                     'Please make the logo bigger');
reset role;
select t_eq('item moved to changes_requested',
            (select status from content_items where id = 'dd000000-0000-0000-0000-000000000001'),
            'changes_requested'::content_status);
select t_eq('revision counted',
            (select revision_count from content_items where id = 'dd000000-0000-0000-0000-000000000001'), 1);
select t_eq('decision is NOT on_behalf',
            (select on_behalf from content_approvals where id = 'ee000000-0000-0000-0000-000000000001'), false);
select t_eq('decision credits the contact',
            (select decided_by_contact_id from content_approvals where id = 'ee000000-0000-0000-0000-000000000001'),
            'cc000000-0000-0000-0000-000000000001'::uuid);
select t_eq('no profile is credited',
            (select decided_by_profile_id from content_approvals where id = 'ee000000-0000-0000-0000-000000000001'),
            null::uuid);
select t_eq('the team sees it in the activity log',
            (select count(*) from activity_log where entity_id = 'dd000000-0000-0000-0000-000000000001'
              and meta->>'by' = 'client')::int, 1);

-- Round 2, approved this time.
insert into content_approvals (id, agency_id, content_item_id, round) values
  ('ee000000-0000-0000-0000-000000000002', (select agency_id from content_items where id = 'dd000000-0000-0000-0000-000000000001'),
   'dd000000-0000-0000-0000-000000000001', 2);
update content_items set status = 'client_approval' where id = 'dd000000-0000-0000-0000-000000000001';

set role authenticated;
select public.portal_decide_approval('ee000000-0000-0000-0000-000000000002', 'approved', 'Perfect, go ahead');
reset role;
select t_eq('approved + a date -> scheduled',
            (select status from content_items where id = 'dd000000-0000-0000-0000-000000000001'),
            'scheduled'::content_status);
select t_eq('approving does not count a revision',
            (select revision_count from content_items where id = 'dd000000-0000-0000-0000-000000000001'), 1);
set role authenticated;

do $$ begin
  perform public.portal_decide_approval('ee000000-0000-0000-0000-000000000002', 'approved');
  raise notice 'FAIL  deciding twice -> no error';
exception when others then raise notice 'PASS  cannot decide the same round twice';
end $$;

\echo '=== a client cannot decide for somebody else ==='

do $$ begin
  perform public.portal_decide_approval('ee000000-0000-0000-0000-000000000005', 'approved');
  raise notice 'FAIL  decided another client of the same agency -> no error';
exception when others then raise notice 'PASS  cannot decide for another client of the same agency';
end $$;

do $$ begin
  perform public.portal_decide_approval('ee000000-0000-0000-0000-000000000006', 'approved');
  raise notice 'FAIL  decided another agency''s approval -> no error';
exception when others then raise notice 'PASS  cannot decide for another agency';
end $$;

select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999993', false);
do $$ begin
  perform public.portal_decide_approval('ee000000-0000-0000-0000-000000000001', 'approved');
  raise notice 'FAIL  stranger decided an approval -> no error';
exception when others then raise notice 'PASS  a stranger cannot decide anything';
end $$;

\echo '=== client comments ==='

select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999991', false);
select public.portal_add_comment('dd000000-0000-0000-0000-000000000001', 'Thanks, looks good now') as cid \gset
reset role;
select t_eq('comment is client-visible',
            (select visible_to_client from content_comments where id = :'cid'), true);
select t_eq('comment is stamped with the contact',
            (select author_contact_id from content_comments where id = :'cid'),
            'cc000000-0000-0000-0000-000000000001'::uuid);
set role authenticated;
select t_eq('client sees their own comment in the view',
            (select count(*) from portal_comments where id = :'cid')::int, 1);

do $$ begin
  perform public.portal_add_comment('dd000000-0000-0000-0000-000000000002', 'commenting on your secret draft');
  raise notice 'FAIL  commented on an unshared draft -> no error';
exception when others then raise notice 'PASS  cannot comment on content never shared with them';
end $$;

do $$ begin
  perform public.portal_add_comment('dd000000-0000-0000-0000-000000000006', 'hello other agency');
  raise notice 'FAIL  commented on another agency''s item -> no error';
exception when others then raise notice 'PASS  cannot comment on another agency''s content';
end $$;

\echo '=== no regression on the internal side ==='

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select t_eq('staff still see all their agency content', (select count(*) from content_items)::int, 5);
select t_eq('staff still see both comments on the item',
            (select count(*) from content_comments
              where content_item_id = 'dd000000-0000-0000-0000-000000000001')::int, 3);
select t_eq('staff see the internal note',
            (select count(*) from content_comments where visible_to_client = false)::int, 1);
select t_eq('staff can still read notes',
            (select notes is not null from content_items where id = 'dd000000-0000-0000-0000-000000000002'), true);
select t_eq('staff are not portal users', public.is_portal_user(), false);

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select t_eq('other agency staff see nothing through portal views',
            (select count(*) from portal_content)::int, 0);

reset role;
