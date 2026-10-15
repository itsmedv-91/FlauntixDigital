-- =============================================================================
-- Flauntix Platform — Phase 4, part 3: influencer marketing and SEO
--
-- Two modules an agency actually sells, in one migration because they are both
-- small and neither has a dependency on the other.
--
-- INFLUENCERS: a roster plus collaborations. The one rule worth stating is that
-- an influencer fee is a COST, so booking a collaboration as paid writes an
-- `expenses` row rather than inventing a second place for money to live. That
-- keeps `client_profitability()` honest without touching it.
--
-- SEO: keywords and a ranking history. Deliberately NOT a rank-tracking
-- integration — every rank API worth using (Semrush, Ahrefs, DataForSEO) is
-- paid and account-gated, so the data comes in by hand or by CSV paste. The
-- schema is the part that would not change if an API were added later: one row
-- per keyword per check, unique on (keyword, date), so a re-import upserts
-- rather than duplicating.
--
-- Idempotent. Requires 0001 and 0006.
-- =============================================================================

do $$ begin create type influencer_status as enum
  ('prospect','contacted','negotiating','active','past','rejected');
exception when duplicate_object then null; end $$;

do $$ begin create type collab_status as enum
  ('planned','briefed','content_due','live','completed','cancelled');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------- influencers
create table if not exists public.influencers (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references public.agencies(id) on delete cascade,
  name            text not null,
  handle          text,
  platform        text not null default 'Instagram',
  profile_url     text,
  followers       integer check (followers is null or followers >= 0),
  /** Percent, as quoted in a media kit. 2.4 means 2.4%. */
  engagement_rate numeric(5,2) check (engagement_rate is null or engagement_rate >= 0),
  niches          text[] not null default '{}',
  city            text,
  email           text,
  phone           text,
  /** Quoted price for one deliverable, before negotiation. */
  rate_card       numeric(12,2) check (rate_card is null or rate_card >= 0),
  status          influencer_status not null default 'prospect',
  notes           text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One campaign with one influencer for one client.
create table if not exists public.influencer_collabs (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  influencer_id  uuid not null references public.influencers(id) on delete cascade,
  client_id      uuid not null references public.clients(id) on delete cascade,
  project_id     uuid references public.projects(id) on delete set null,
  title          text not null,
  deliverables   text,
  /** What we agreed to pay, which is a cost. Not what we charge the client. */
  fee            numeric(12,2) not null default 0 check (fee >= 0),
  brief_url      text,
  live_url       text,
  go_live_on     date,
  status         collab_status not null default 'planned',
  /** Set when the fee has been booked as an expense, so it cannot double up. */
  expense_id     uuid references public.expenses(id) on delete set null,
  notes          text,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists influencers_agency_idx on public.influencers (agency_id, status);
create index if not exists collabs_agency_idx     on public.influencer_collabs (agency_id, go_live_on);
create index if not exists collabs_client_idx     on public.influencer_collabs (client_id);
create index if not exists collabs_influencer_idx on public.influencer_collabs (influencer_id);

drop trigger if exists touch_influencers on public.influencers;
create trigger touch_influencers before update on public.influencers
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_influencer_collabs on public.influencer_collabs;
create trigger touch_influencer_collabs before update on public.influencer_collabs
  for each row execute function public.touch_updated_at();

alter table public.influencers        enable row level security;
alter table public.influencer_collabs enable row level security;

-- The roster carries contact details and negotiated rates, so it is staff-only
-- for reading and manager-and-above for writing — the same line as the CRM.
drop policy if exists influencers_select on public.influencers;
create policy influencers_select on public.influencers
  for select using (public.is_staff(agency_id));
drop policy if exists influencers_write on public.influencers;
create policy influencers_write on public.influencers
  for all using (public.is_manager(agency_id)) with check (public.is_manager(agency_id));

drop policy if exists collabs_select on public.influencer_collabs;
create policy collabs_select on public.influencer_collabs
  for select using (public.is_staff(agency_id));
drop policy if exists collabs_write on public.influencer_collabs;
create policy collabs_write on public.influencer_collabs
  for all using (public.is_manager(agency_id)) with check (public.is_manager(agency_id));

/**
 * Books a collaboration's fee as a client expense, once.
 *
 * SECURITY DEFINER so the two writes cannot half-happen: an expense with no
 * link back would be invisible to the collab, and a link with no expense would
 * flatter the margin. Refuses a second call, which is what `expense_id` is for.
 */
create or replace function public.book_collab_fee(collab_id uuid, on_date date default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c   record;
  eid uuid;
begin
  select * into c from public.influencer_collabs where id = collab_id;
  if c is null then raise exception 'No such collaboration'; end if;
  if not public.is_manager(c.agency_id) then
    raise exception 'Only a manager can book a fee';
  end if;
  if c.expense_id is not null then
    raise exception 'This fee is already booked as an expense';
  end if;
  if c.fee <= 0 then raise exception 'Set the fee before booking it'; end if;

  insert into public.expenses
    (agency_id, client_id, project_id, incurred_on, category, description, amount, vendor, rebilled)
  select c.agency_id, c.client_id, c.project_id,
         coalesce(on_date, c.go_live_on, (now() at time zone 'Asia/Kolkata')::date),
         'Influencer fees',
         c.title || ' — ' || i.name,
         c.fee,
         i.name,
         false
  from public.influencers i where i.id = c.influencer_id
  returning id into eid;

  update public.influencer_collabs set expense_id = eid where id = collab_id;
  return eid;
end $$;

revoke all on function public.book_collab_fee(uuid, date) from public, anon;
grant execute on function public.book_collab_fee(uuid, date) to authenticated;

-- ------------------------------------------------------------------- SEO
create table if not exists public.seo_keywords (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  client_id      uuid not null references public.clients(id) on delete cascade,
  keyword        text not null,
  /** The page we want to rank. Null while that is still undecided. */
  target_url     text,
  search_volume  integer check (search_volume is null or search_volume >= 0),
  /** 0–100, however the tool it came from defines it. */
  difficulty     integer check (difficulty is null or difficulty between 0 and 100),
  priority       integer not null default 2 check (priority between 1 and 3),
  active         boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (client_id, keyword)
);

-- One row per keyword per check. `position` null means "not in the top 100",
-- which is a real and different answer from "we did not check".
create table if not exists public.seo_rankings (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  keyword_id  uuid not null references public.seo_keywords(id) on delete cascade,
  checked_on  date not null,
  position    integer check (position is null or position between 1 and 100),
  ranking_url text,
  source      text,
  created_at  timestamptz not null default now(),
  unique (keyword_id, checked_on)
);

create index if not exists seo_keywords_client_idx on public.seo_keywords (client_id, active);
create index if not exists seo_rankings_keyword_idx on public.seo_rankings (keyword_id, checked_on desc);

drop trigger if exists touch_seo_keywords on public.seo_keywords;
create trigger touch_seo_keywords before update on public.seo_keywords
  for each row execute function public.touch_updated_at();

alter table public.seo_keywords enable row level security;
alter table public.seo_rankings enable row level security;

-- SEO work is client delivery, so it follows the content line rather than the
-- CRM one: staff read and write, freelancers see nothing (no SEO assignment
-- model exists, and inventing one here would be guessing).
drop policy if exists seo_keywords_select on public.seo_keywords;
create policy seo_keywords_select on public.seo_keywords
  for select using (public.is_staff(agency_id));
drop policy if exists seo_keywords_write on public.seo_keywords;
create policy seo_keywords_write on public.seo_keywords
  for all using (public.is_staff(agency_id)) with check (public.is_staff(agency_id));

drop policy if exists seo_rankings_select on public.seo_rankings;
create policy seo_rankings_select on public.seo_rankings
  for select using (public.is_staff(agency_id));
drop policy if exists seo_rankings_write on public.seo_rankings;
create policy seo_rankings_write on public.seo_rankings
  for all using (public.is_staff(agency_id)) with check (public.is_staff(agency_id));

/**
 * Where each keyword started and where it is now, over a window.
 *
 * "Improved" is a FALL in position, which is the thing that gets written the
 * wrong way round every time: `delta` is first - latest, so positive means the
 * keyword climbed.
 *
 * `delta` is null rather than a number whenever a change cannot honestly be
 * claimed: a keyword with no first or last position (it entered or left the top
 * 100 during the window), and a keyword checked only ONCE in the window — one
 * data point is not "no change", it is no information.
 */
create or replace function public.seo_progress(agency uuid, client uuid, from_date date, to_date date)
returns table (
  keyword_id     uuid,
  keyword        text,
  target_url     text,
  search_volume  integer,
  difficulty     integer,
  priority       integer,
  first_checked  date,
  first_position integer,
  last_checked   date,
  last_position  integer,
  best_position  integer,
  delta          integer,
  checks         integer
)
language sql
stable
security invoker
as $$
  with k as (
    select * from public.seo_keywords
    where agency_id = agency and client_id = client and active
  ),
  r as (
    select s.* from public.seo_rankings s
    join k on k.id = s.keyword_id
    where s.checked_on between from_date and to_date
  ),
  firsts as (
    select distinct on (r.keyword_id) r.keyword_id, r.checked_on, r.position
    from r order by r.keyword_id, r.checked_on asc
  ),
  lasts as (
    select distinct on (r.keyword_id) r.keyword_id, r.checked_on, r.position
    from r order by r.keyword_id, r.checked_on desc
  )
  select k.id, k.keyword, k.target_url, k.search_volume, k.difficulty, k.priority,
         f.checked_on, f.position,
         l.checked_on, l.position,
         (select min(r2.position) from r r2 where r2.keyword_id = k.id),
         case when f.position is null or l.position is null then null
              when (select count(*) from r r4 where r4.keyword_id = k.id) < 2 then null
              else f.position - l.position end,
         (select count(*)::integer from r r3 where r3.keyword_id = k.id)
  from k
  left join firsts f on f.keyword_id = k.id
  left join lasts  l on l.keyword_id = k.id
  order by k.priority, k.keyword;
$$;
