-- Behaviour tests for 0012_influencers_seo.sql.
--
-- Two things are worth testing hard: a collaboration fee must reach the margin
-- exactly once, and `seo_progress()` must report an improvement as an
-- improvement — a position getting SMALLER is the thing that gets written the
-- wrong way round every time.
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
  ('66666666-6666-6666-6666-666666666666', 'mgr-a@test.in',    '{"full_name":"Manager A"}'),
  ('44444444-4444-4444-4444-444444444444', 'owner-b@test.in',  '{"full_name":"Owner B"}');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select create_agency('Agency A') as agency_a \gset
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select create_agency('Agency B') as agency_b \gset

insert into memberships (agency_id, user_id, role) values
  (:'agency_a', '22222222-2222-2222-2222-222222222222', 'member'),
  (:'agency_a', '33333333-3333-3333-3333-333333333333', 'freelancer'),
  (:'agency_a', '66666666-6666-6666-6666-666666666666', 'manager');

insert into clients (id, agency_id, name, status, state_code) values
  ('aaaaaaaa-0000-0000-0000-000000000001', :'agency_a', 'SEO Client', 'active', '27');

select set_config('test.agency', :'agency_a', false);
select set_config('test.client', 'aaaaaaaa-0000-0000-0000-000000000001', false);

set role authenticated;

-- ------------------------------------------------- who can touch the roster
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  begin
    insert into influencers (agency_id, name) values (current_setting('test.agency')::uuid, 'Member added');
    raise notice 'FAIL  a member added to the roster';
  exception when insufficient_privilege then
    raise notice 'PASS  a member cannot add to the roster';
  end;
end $$;

select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
insert into influencers (id, agency_id, name, handle, platform, followers, rate_card, status)
values ('ffffffff-0000-0000-0000-000000000001', :'agency_a', 'Riya Shah', '@riyashah',
        'Instagram', 125000, 25000, 'active');
select t_eq('a manager can add to the roster', count(*), 1::bigint) from influencers;

-- A member reads the roster (they brief these people) but cannot change it.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select t_eq('a member can read the roster', count(*), 1::bigint) from influencers;

-- A freelancer is not staff, so they see nothing at all.
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select t_eq('a freelancer sees no roster', count(*), 0::bigint) from influencers;
select t_eq('a freelancer sees no keywords', count(*), 0::bigint) from seo_keywords;

-- ------------------------------------------------------ booking a fee once
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
insert into influencer_collabs (id, agency_id, influencer_id, client_id, title, fee, go_live_on)
values ('cccccccc-0000-0000-0000-000000000001', :'agency_a',
        'ffffffff-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Diwali reel', 25000, '2026-10-20');

select set_config('test.collab', 'cccccccc-0000-0000-0000-000000000001', false);

select t_eq('booking the fee returns an expense',
            (book_collab_fee('cccccccc-0000-0000-0000-000000000001') is not null), true);
select t_eq('the expense is a client cost of the right amount', sum(amount), 25000::numeric)
  from expenses where category = 'Influencer fees';
select t_eq('the expense is booked against the client', count(*), 1::bigint)
  from expenses
  where category = 'Influencer fees'
    and client_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select t_eq('the expense is not marked rebilled', count(*), 0::bigint)
  from expenses where category = 'Influencer fees' and rebilled;
select t_eq('the collab now points at the expense', count(*), 1::bigint)
  from influencer_collabs where id = 'cccccccc-0000-0000-0000-000000000001' and expense_id is not null;

-- The whole point of expense_id: a second booking must be refused, not add a
-- second cost that quietly halves the margin.
do $$ begin
  begin
    perform book_collab_fee(current_setting('test.collab')::uuid);
    raise notice 'FAIL  the fee was booked twice';
  exception when others then
    raise notice 'PASS  the fee cannot be booked twice';
  end;
end $$;
select t_eq('still exactly one expense', count(*), 1::bigint)
  from expenses where category = 'Influencer fees';

-- It reaches the margin, which is the reason for doing it this way.
select t_eq('the fee shows up as a client cost', expense_cost, 25000::numeric)
  from client_profitability(:'agency_a', '2026-10-01', '2026-10-31');

-- A member cannot book a fee.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
insert into influencer_collabs (id, agency_id, influencer_id, client_id, title, fee)
select 'cccccccc-0000-0000-0000-000000000002', :'agency_a',
       'ffffffff-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
       'Second', 5000
where false;  -- a member cannot insert one anyway; this documents it

select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
insert into influencer_collabs (id, agency_id, influencer_id, client_id, title, fee)
values ('cccccccc-0000-0000-0000-000000000002', :'agency_a',
        'ffffffff-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Second', 5000);
select set_config('test.collab2', 'cccccccc-0000-0000-0000-000000000002', false);

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  begin
    perform book_collab_fee(current_setting('test.collab2')::uuid);
    raise notice 'FAIL  a member booked a fee';
  exception when others then
    raise notice 'PASS  a member cannot book a fee';
  end;
end $$;

-- ------------------------------------------------------------------- SEO
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);

insert into seo_keywords (id, agency_id, client_id, keyword, priority, search_volume) values
  ('11110000-0000-0000-0000-000000000001', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'social media agency pune', 1, 1300),
  ('11110000-0000-0000-0000-000000000002', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'performance marketing pune', 2, 400),
  ('11110000-0000-0000-0000-000000000003', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'never checked', 3, 90),
  ('11110000-0000-0000-0000-000000000004', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'archived one', 3, 10);
update seo_keywords set active = false where id = '11110000-0000-0000-0000-000000000004';

do $$ begin
  begin
    insert into seo_keywords (agency_id, client_id, keyword)
    values (current_setting('test.agency')::uuid, current_setting('test.client')::uuid,
            'social media agency pune');
    raise notice 'FAIL  the same keyword was tracked twice for one client';
  exception when unique_violation then
    raise notice 'PASS  the same keyword cannot be tracked twice for one client';
  end;
end $$;

-- Keyword 1 climbs 42 → 14. Keyword 2 slips 8 → 19.
insert into seo_rankings (agency_id, keyword_id, checked_on, position) values
  (:'agency_a', '11110000-0000-0000-0000-000000000001', '2026-08-01', 42),
  (:'agency_a', '11110000-0000-0000-0000-000000000001', '2026-09-01', 23),
  (:'agency_a', '11110000-0000-0000-0000-000000000001', '2026-10-01', 14),
  (:'agency_a', '11110000-0000-0000-0000-000000000002', '2026-08-01', 8),
  (:'agency_a', '11110000-0000-0000-0000-000000000002', '2026-10-01', 19);

-- Re-checking the same day corrects the figure rather than adding a row.
insert into seo_rankings (agency_id, keyword_id, checked_on, position)
values (:'agency_a', '11110000-0000-0000-0000-000000000001', '2026-10-01', 11)
on conflict (keyword_id, checked_on) do update set position = excluded.position;
select t_eq('re-checking a day corrects it', count(*), 3::bigint)
  from seo_rankings where keyword_id = '11110000-0000-0000-0000-000000000001';

select t_eq('a climb is reported as positive', delta, 31)
  from seo_progress(:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-08-01', '2026-10-31')
  where keyword = 'social media agency pune';
select t_eq('the current position is the latest check', last_position, 11)
  from seo_progress(:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-08-01', '2026-10-31')
  where keyword = 'social media agency pune';
select t_eq('the best position is the best, not the latest', best_position, 11)
  from seo_progress(:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-08-01', '2026-10-31')
  where keyword = 'social media agency pune';
select t_eq('a slip is reported as negative', delta, -11)
  from seo_progress(:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-08-01', '2026-10-31')
  where keyword = 'performance marketing pune';
select t_eq('a never-checked keyword still appears', checks, 0)
  from seo_progress(:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-08-01', '2026-10-31')
  where keyword = 'never checked';
select t_eq('a never-checked keyword has no invented delta', delta, null::integer)
  from seo_progress(:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-08-01', '2026-10-31')
  where keyword = 'never checked';
select t_eq('an archived keyword is left out', count(*), 3::bigint)
  from seo_progress(:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-08-01', '2026-10-31');

-- A window holding a single check is not "no change" — it is no information, so
-- the delta is null rather than a reassuring zero.
select t_eq('a one-check window gives no delta', delta, null::integer)
  from seo_progress(:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-09-20', '2026-10-31')
  where keyword = 'social media agency pune';

-- "Not in the top 100" is a real answer, kept distinct from not checking.
insert into seo_rankings (agency_id, keyword_id, checked_on, position)
values (:'agency_a', '11110000-0000-0000-0000-000000000003', '2026-10-05', null);
select t_eq('an unranked check counts as a check', checks, 1)
  from seo_progress(:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-08-01', '2026-10-31')
  where keyword = 'never checked';
select t_eq('an unranked check has no position', last_position, null::integer)
  from seo_progress(:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-08-01', '2026-10-31')
  where keyword = 'never checked';

-- A position outside 1–100 is a bug upstream, not data.
do $$ begin
  begin
    insert into seo_rankings (agency_id, keyword_id, checked_on, position)
    values (current_setting('test.agency')::uuid, '11110000-0000-0000-0000-000000000002',
            '2026-11-01', 140);
    raise notice 'FAIL  a position above 100 was accepted';
  exception when check_violation then
    raise notice 'PASS  a position above 100 is refused';
  end;
end $$;

-- ------------------------------------------------------ tenant isolation
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select t_eq('other agency sees no influencers', count(*), 0::bigint) from influencers;
select t_eq('other agency sees no collabs', count(*), 0::bigint) from influencer_collabs;
select t_eq('other agency sees no keywords', count(*), 0::bigint) from seo_keywords;
select t_eq('other agency sees no rankings', count(*), 0::bigint) from seo_rankings;
select t_eq('other agency gets nothing from seo_progress', count(*), 0::bigint)
  from seo_progress(:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-08-01', '2026-10-31');
do $$ begin
  begin
    perform book_collab_fee(current_setting('test.collab2')::uuid);
    raise notice 'FAIL  another agency booked our fee';
  exception when others then
    raise notice 'PASS  another agency cannot book our fee';
  end;
end $$;

reset role;
