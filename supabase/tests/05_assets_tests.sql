-- Behaviour tests for 0005_assets.sql: who can see which assets, and who can
-- put objects where in the storage bucket.
--
-- Scope note: the storage half runs against the mock in 01_mock_storage.sql, so
-- it exercises the policy expressions, not Supabase's storage service. Signed
-- URLs, the upload API and file_size_limit live outside Postgres.
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
delete from storage.objects;
delete from agencies;
delete from auth.users;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@test.in',  '{"full_name":"Owner A"}'),
  ('22222222-2222-2222-2222-222222222222', 'member-a@test.in', '{"full_name":"Member A"}'),
  ('33333333-3333-3333-3333-333333333333', 'free-a@test.in',   '{"full_name":"Freelancer A"}'),
  ('55555555-5555-5555-5555-555555555555', 'free2-a@test.in',  '{"full_name":"Freelancer Two"}'),
  ('99999999-9999-9999-9999-999999999991', 'priya@clienta.in', '{}'),
  ('44444444-4444-4444-4444-444444444444', 'owner-b@test.in',  '{"full_name":"Owner B"}');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select create_agency('Agency A') as agency_a \gset
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select create_agency('Agency B') as agency_b \gset

insert into memberships (agency_id, user_id, role) values
  (:'agency_a', '22222222-2222-2222-2222-222222222222', 'member'),
  (:'agency_a', '33333333-3333-3333-3333-333333333333', 'freelancer'),
  (:'agency_a', '55555555-5555-5555-5555-555555555555', 'freelancer');

insert into clients (id, agency_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', :'agency_a', 'Client A1'),
  ('aaaaaaaa-0000-0000-0000-000000000002', :'agency_a', 'Client A2'),
  ('bbbbbbbb-0000-0000-0000-000000000001', :'agency_b', 'Client B1');

insert into client_contacts (agency_id, client_id, name, email, portal_enabled) values
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', 'Priya Nair', 'priya@clienta.in', true);

-- Freelancer A has a task for Client A1 only. Freelancer Two has a content item
-- for Client A2 only — so the two should see different halves of the library.
insert into tasks (agency_id, client_id, title, assignee_id) values
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', 'Edit the Diwali reel',
   '33333333-3333-3333-3333-333333333333');
insert into content_items (agency_id, client_id, title, assignee_id) values
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000002', 'A2 carousel',
   '55555555-5555-5555-5555-555555555555');

insert into assets (id, agency_id, client_id, name, kind, storage_path, mime_type, size_bytes, uploaded_by) values
  ('a5000000-0000-0000-0000-000000000001', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Client A1 logo (primary)', 'logo',
   :'agency_a' || '/aaaaaaaa-0000-0000-0000-000000000001/logo-v1.svg', 'image/svg+xml', 20480,
   '11111111-1111-1111-1111-111111111111'),
  ('a5000000-0000-0000-0000-000000000002', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000002',
   'Client A2 brand guide', 'brand_guide',
   :'agency_a' || '/aaaaaaaa-0000-0000-0000-000000000002/guide.pdf', 'application/pdf', 4194304,
   '11111111-1111-1111-1111-111111111111'),
  ('a5000000-0000-0000-0000-000000000003', :'agency_a', null,
   'Flauntix deck template', 'template',
   :'agency_a' || '/_agency/deck.potx', 'application/vnd.ms-powerpoint', 1048576,
   '11111111-1111-1111-1111-111111111111'),
  ('a5000000-0000-0000-0000-000000000004', :'agency_b', 'bbbbbbbb-0000-0000-0000-000000000001',
   'B client logo', 'logo',
   :'agency_b' || '/bbbbbbbb-0000-0000-0000-000000000001/logo.png', 'image/png', 30720,
   '44444444-4444-4444-4444-444444444444');

-- Matching storage objects.
insert into storage.objects (bucket_id, name) select 'assets', storage_path from assets;

\echo '=== path_agency() parses safely ==='
select t_eq('reads the agency id from a path',
            public.path_agency(:'agency_a' || '/x/y.png'), :'agency_a'::uuid);
select t_eq('junk prefix is null, not an error', public.path_agency('not-a-uuid/x.png'), null::uuid);
select t_eq('empty path is null',                public.path_agency(''), null::uuid);
select t_eq('null path is null',                 public.path_agency(null), null::uuid);
select t_eq('a bare filename is null',           public.path_agency('logo.png'), null::uuid);
-- is_staff(null) must deny rather than blow up, which is what makes the above safe.
select t_eq('is_staff(null) denies', public.is_staff(null), false);

\echo '=== who sees which assets ==='

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select t_eq('owner sees the whole agency library', (select count(*) from assets)::int, 3);

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select t_eq('a member sees the whole agency library', (select count(*) from assets)::int, 3);

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select t_eq('freelancer sees agency assets + their client only', (select count(*) from assets)::int, 2);
select t_eq('freelancer gets the logo for the client they work on',
            (select count(*) from assets where id = 'a5000000-0000-0000-0000-000000000001')::int, 1);
select t_eq('freelancer does not see another client''s brand guide',
            (select count(*) from assets where id = 'a5000000-0000-0000-0000-000000000002')::int, 0);
select t_eq('freelancer does see agency-level templates',
            (select count(*) from assets where id = 'a5000000-0000-0000-0000-000000000003')::int, 1);

-- The second freelancer is attached through a content item, not a task.
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
select t_eq('content-item assignee sees that client''s assets',
            (select count(*) from assets where id = 'a5000000-0000-0000-0000-000000000002')::int, 1);
select t_eq('and not the other client''s',
            (select count(*) from assets where id = 'a5000000-0000-0000-0000-000000000001')::int, 0);

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select t_eq('agency B sees only its own asset', (select count(*) from assets)::int, 1);

select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999991', false);
select t_eq('a portal client sees no assets', (select count(*) from assets)::int, 0);

\echo '=== writing to the assets table is gated by role ==='

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
do $$ begin
  insert into assets (agency_id, client_id, name, storage_path)
  values ((select id from agencies limit 1), 'aaaaaaaa-0000-0000-0000-000000000001', 'Sneaky', 'x/y/z.png');
  raise notice 'FAIL  freelancer blocked from adding assets -> insert succeeded';
exception when others then raise notice 'PASS  freelancer blocked from adding assets (%)', sqlstate;
end $$;

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
with added as (
  insert into assets (agency_id, client_id, name, storage_path)
  values (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', 'Member upload',
          :'agency_a' || '/aaaaaaaa-0000-0000-0000-000000000001/member.png')
  returning 1
)
select t_eq('a member (staff) can add an asset', (select count(*) from added)::int, 1);

do $$ begin
  delete from assets where id = 'a5000000-0000-0000-0000-000000000001';
  if (select count(*) from assets where id = 'a5000000-0000-0000-0000-000000000001') = 0 then
    raise notice 'FAIL  a member deleted an asset';
  else
    raise notice 'PASS  a member cannot delete an asset';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
with removed as (delete from assets where name = 'Member upload' returning 1)
select t_eq('a manager can delete an asset', (select count(*) from removed)::int, 1);

select t_eq('storage paths are unique',
            (select count(*) from assets where storage_path = :'agency_a' || '/_agency/deck.potx')::int, 1);
reset role;
do $$ begin
  insert into assets (agency_id, client_id, name, storage_path)
  values ((select id from agencies order by name limit 1), null, 'Duplicate path',
          (select storage_path from assets where id = 'a5000000-0000-0000-0000-000000000003'));
  raise notice 'FAIL  duplicate storage path accepted';
exception when unique_violation then raise notice 'PASS  duplicate storage path rejected';
end $$;

\echo '=== storage objects: the path prefix decides who may upload ==='

set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
with uploaded as (
  insert into storage.objects (bucket_id, name)
  values ('assets', :'agency_a' || '/aaaaaaaa-0000-0000-0000-000000000001/new.png')
  returning 1
)
select t_eq('staff can upload under their own agency prefix', (select count(*) from uploaded)::int, 1);

do $$ begin
  insert into storage.objects (bucket_id, name)
  values ('assets',
          (select id from agencies where name = 'Agency B')::text
            || '/bbbbbbbb-0000-0000-0000-000000000001/stolen.png');
  raise notice 'FAIL  uploaded under ANOTHER agency''s prefix';
exception when others then raise notice 'PASS  cannot upload under another agency''s prefix (%)', sqlstate;
end $$;

do $$ begin
  insert into storage.objects (bucket_id, name) values ('assets', 'no-agency-here/x.png');
  raise notice 'FAIL  uploaded under a malformed prefix';
exception when others then raise notice 'PASS  a malformed prefix is refused, not an error (%)', sqlstate;
end $$;

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
do $$ begin
  insert into storage.objects (bucket_id, name)
  values ('assets',
          (select id from agencies where name = 'Agency A')::text
            || '/aaaaaaaa-0000-0000-0000-000000000001/freelancer.png');
  raise notice 'FAIL  a freelancer uploaded an object';
exception when others then raise notice 'PASS  a freelancer cannot upload objects (%)', sqlstate;
end $$;

select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999991', false);
do $$ begin
  insert into storage.objects (bucket_id, name)
  values ('assets',
          (select id from agencies where name = 'Agency A')::text
            || '/aaaaaaaa-0000-0000-0000-000000000001/portal.png');
  raise notice 'FAIL  a portal client uploaded an object';
exception when others then raise notice 'PASS  a portal client cannot upload objects (%)', sqlstate;
end $$;

\echo '=== reading objects follows the assets table ==='

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select t_eq('owner reads their agency''s three objects',
            (select count(*) from storage.objects where bucket_id = 'assets')::int, 3);

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select t_eq('freelancer reads only the objects they may see',
            (select count(*) from storage.objects where bucket_id = 'assets')::int, 2);

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select t_eq('agency B reads only its own object',
            (select count(*) from storage.objects where bucket_id = 'assets')::int, 1);

select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999991', false);
select t_eq('a portal client reads no objects',
            (select count(*) from storage.objects where bucket_id = 'assets')::int, 0);

-- An object with no matching assets row is invisible to everyone: that is what
-- keeps a half-finished upload from being readable.
reset role;
insert into storage.objects (bucket_id, name) values ('assets', :'agency_a' || '/_agency/orphan.png');
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select t_eq('an orphaned object is not readable',
            (select count(*) from storage.objects where name like '%orphan%')::int, 0);

\echo '=== deleting objects is managers only ==='

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
with tried as (
  delete from storage.objects where name = :'agency_a' || '/_agency/deck.potx' returning 1
)
select t_eq('a member cannot delete an object', (select count(*) from tried)::int, 0);

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
with purged as (
  delete from storage.objects where name = :'agency_a' || '/_agency/deck.potx' returning 1
)
select t_eq('a manager can delete an object', (select count(*) from purged)::int, 1);

\echo '=== replacing an asset keeps the old version ==='

reset role;
insert into assets (id, agency_id, client_id, name, kind, storage_path) values
  ('a5000000-0000-0000-0000-000000000011', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Client A1 logo (primary)', 'logo', :'agency_a' || '/aaaaaaaa-0000-0000-0000-000000000001/logo-v2.svg');

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.replace_asset('a5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000011');
reset role;
select t_eq('the replacement is version 2',
            (select version from assets where id = 'a5000000-0000-0000-0000-000000000011'), 2);
select t_eq('it points at what it replaced',
            (select replaces_id from assets where id = 'a5000000-0000-0000-0000-000000000011'),
            'a5000000-0000-0000-0000-000000000001'::uuid);
select t_eq('the old version is archived, not deleted',
            (select archived_at is not null from assets where id = 'a5000000-0000-0000-0000-000000000001'), true);
select t_eq('the old file is still there to download',
            (select count(*) from storage.objects
              where name = :'agency_a' || '/aaaaaaaa-0000-0000-0000-000000000001/logo-v1.svg')::int, 1);
select t_eq('the team sees the replacement in the activity log',
            (select count(*) from activity_log where entity_type = 'asset' and action = 'replaced')::int, 1);

set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
do $$ begin
  perform public.replace_asset('a5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000011');
  raise notice 'FAIL  another agency replaced our asset';
exception when others then raise notice 'PASS  another agency cannot replace our asset';
end $$;

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
do $$ begin
  perform public.replace_asset('a5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000011');
  raise notice 'FAIL  a freelancer replaced an asset';
exception when others then raise notice 'PASS  a freelancer cannot replace an asset';
end $$;

reset role;
