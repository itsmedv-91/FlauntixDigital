-- =============================================================================
-- Flauntix Platform — Phase 2, part 2: client portal
-- Client contacts sign in with a magic link and approve their own content.
--
-- Design: portal users are NOT members. They get no row in `memberships` and no
-- `member_role`, so none of the internal policies change. Access is derived from
-- `client_contacts` (which must be explicitly portal-enabled per contact).
--
-- Portal users have NO direct read access to content_items / content_approvals /
-- content_comments — the internal policies already exclude them. They read three
-- security-barrier views instead, which expose only client-safe columns (so
-- `content_items.notes` and internal comments can never reach a client) and write
-- only through two SECURITY DEFINER RPCs.
-- Idempotent: safe to re-run. Requires 0001 + 0002.
-- =============================================================================

-- ---------------------------------------------------------------- columns
alter table public.client_contacts
  add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.client_contacts
  add column if not exists portal_enabled boolean not null default false;
alter table public.client_contacts
  add column if not exists last_portal_login timestamptz;

create index if not exists contacts_portal_user_idx  on public.client_contacts (user_id);
create index if not exists contacts_portal_email_idx on public.client_contacts (lower(email)) where portal_enabled;

-- ---------------------------------------------------------------- helpers
-- The signed-in user's email. SECURITY DEFINER because auth.users is not
-- readable by `authenticated` on its own.
create or replace function public.auth_email() returns text
language sql stable security definer set search_path = public, auth as $$
  select email from auth.users where id = auth.uid();
$$;

-- Clients the caller may see through the portal. Matching on user_id OR email
-- means the very first page load works before claim_portal_access() has run.
create or replace function public.portal_client_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select cc.client_id
  from public.client_contacts cc
  where cc.portal_enabled
    and auth.uid() is not null
    and (cc.user_id = auth.uid() or lower(cc.email) = lower(public.auth_email()));
$$;

create or replace function public.is_portal_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.portal_client_ids());
$$;

grant execute on function public.auth_email() to authenticated;
grant execute on function public.portal_client_ids() to authenticated;
grant execute on function public.is_portal_user() to authenticated;

-- ---------------------------------------------------------------- views
-- Statuses a client is allowed to know about: drafts and internal review stay
-- hidden until somebody deliberately sends the work over.
create or replace view public.portal_content with (security_barrier = true) as
select
  ci.id,
  ci.client_id,
  cl.name            as client_name,
  ag.id              as agency_id,
  ag.name            as agency_name,
  ci.title,
  ci.caption,
  ci.hashtags,
  ci.platforms,
  ci.format,
  ci.status,
  ci.scheduled_date,
  ci.scheduled_time,
  ci.asset_urls,
  ci.published_url,
  ci.published_at,
  ci.revision_count,
  ci.updated_at
from public.content_items ci
join public.clients  cl on cl.id = ci.client_id
join public.agencies ag on ag.id = ci.agency_id
where ci.client_id in (select public.portal_client_ids())
  and ci.status in ('client_approval','changes_requested','approved','scheduled','published');

create or replace view public.portal_approvals with (security_barrier = true) as
select
  a.id,
  a.content_item_id,
  a.round,
  a.decision,
  a.requested_at,
  a.decided_at,
  a.comment,
  a.on_behalf,
  cc.name as decided_by_name
from public.content_approvals a
left join public.client_contacts cc on cc.id = a.decided_by_contact_id
where a.content_item_id in (select id from public.portal_content);

-- Internal notes never appear here: visible_to_client has to be set explicitly.
create or replace view public.portal_comments with (security_barrier = true) as
select
  m.id,
  m.content_item_id,
  m.body,
  m.created_at,
  m.author_contact_id,
  cc.name as contact_name
from public.content_comments m
left join public.client_contacts cc on cc.id = m.author_contact_id
where m.visible_to_client
  and m.content_item_id in (select id from public.portal_content);

-- Who the caller is, which clients they cover, and whose agency it is.
create or replace view public.portal_me with (security_barrier = true) as
select
  cc.id   as contact_id,
  cc.name,
  cc.email,
  cc.designation,
  cc.client_id,
  cl.name as client_name,
  ag.id   as agency_id,
  ag.name as agency_name
from public.client_contacts cc
join public.clients  cl on cl.id = cc.client_id
join public.agencies ag on ag.id = cc.agency_id
where cc.portal_enabled
  and auth.uid() is not null
  and (cc.user_id = auth.uid() or lower(cc.email) = lower(public.auth_email()));

grant select on public.portal_content   to authenticated;
grant select on public.portal_approvals to authenticated;
grant select on public.portal_comments  to authenticated;
grant select on public.portal_me        to authenticated;

-- ---------------------------------------------------------------- RPCs
-- Binds the auth user to their contact rows on first sign-in, so later lookups
-- do not depend on the email still matching.
create or replace function public.claim_portal_access() returns integer
language plpgsql security definer set search_path = public, auth as $$
declare touched integer;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;

  update client_contacts cc
     set user_id = auth.uid(),
         last_portal_login = now()
   where cc.portal_enabled
     and lower(cc.email) = lower(public.auth_email())
     and (cc.user_id is null or cc.user_id = auth.uid());
  get diagnostics touched = row_count;
  return touched;
end $$;

-- The client's own decision. Unlike decide_content_approval (a team member
-- recording what the client said), this sets on_behalf = false.
create or replace function public.portal_decide_approval(
  approval_id uuid,
  new_decision approval_decision,
  decision_comment text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  appr content_approvals%rowtype;
  item content_items%rowtype;
  my_contact uuid;
begin
  if new_decision = 'pending' then raise exception 'Choose approved or changes_requested'; end if;

  select * into appr from content_approvals where id = approval_id;
  if not found then raise exception 'Approval not found'; end if;
  if appr.decision <> 'pending' then raise exception 'This has already been decided'; end if;

  select * into item from content_items where id = appr.content_item_id;

  select cc.id into my_contact
    from client_contacts cc
   where cc.client_id = item.client_id
     and cc.portal_enabled
     and (cc.user_id = auth.uid() or lower(cc.email) = lower(public.auth_email()))
   order by cc.is_primary desc
   limit 1;
  if my_contact is null then raise exception 'Not allowed'; end if;

  if new_decision = 'changes_requested' and coalesce(trim(decision_comment), '') = '' then
    raise exception 'Please say what needs changing';
  end if;

  update content_approvals
     set decision = new_decision,
         comment = decision_comment,
         decided_at = now(),
         decided_by_contact_id = my_contact,
         decided_by_profile_id = null,
         on_behalf = false
   where id = approval_id;

  if new_decision = 'approved' then
    update content_items
       set status = case
                      when scheduled_date is not null then 'scheduled'::content_status
                      else 'approved'::content_status
                    end
     where id = item.id;
  else
    update content_items
       set status = 'changes_requested', revision_count = revision_count + 1
     where id = item.id;
  end if;

  insert into activity_log (agency_id, actor_id, entity_type, entity_id, action, meta)
  values (item.agency_id,
          (select id from profiles where id = auth.uid()),
          'content', item.id,
          case when new_decision = 'approved' then 'approved' else 'changes_requested' end,
          jsonb_build_object('title', item.title, 'round', appr.round, 'by', 'client'));
end $$;

-- A client comment is always visible to the client side, and is stamped with
-- the contact so the team can tell it apart from their own notes.
create or replace function public.portal_add_comment(item_id uuid, body text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  item content_items%rowtype;
  my_contact uuid;
  new_id uuid;
begin
  if coalesce(trim(body), '') = '' then raise exception 'Write something first'; end if;

  select * into item from content_items where id = item_id;
  if not found then raise exception 'Content not found'; end if;

  select cc.id into my_contact
    from client_contacts cc
   where cc.client_id = item.client_id
     and cc.portal_enabled
     and (cc.user_id = auth.uid() or lower(cc.email) = lower(public.auth_email()))
   order by cc.is_primary desc
   limit 1;
  if my_contact is null then raise exception 'Not allowed'; end if;

  -- Only on content that has actually been shared with them.
  if item.status not in ('client_approval','changes_requested','approved','scheduled','published') then
    raise exception 'Not allowed';
  end if;

  insert into content_comments (agency_id, content_item_id, author_id, author_contact_id, body, visible_to_client)
  values (item.agency_id,
          item_id,
          (select id from profiles where id = auth.uid()),
          my_contact,
          left(trim(body), 5000),
          true)
  returning id into new_id;
  return new_id;
end $$;

grant execute on function public.claim_portal_access() to authenticated;
grant execute on function public.portal_decide_approval(uuid, approval_decision, text) to authenticated;
grant execute on function public.portal_add_comment(uuid, text) to authenticated;

-- ---------------------------------------------------------------- RLS
-- One addition on the internal side: a portal user must be able to read their
-- own contact row (the portal_me view covers the rest).
drop policy if exists contacts_portal_self on public.client_contacts;
create policy contacts_portal_self on public.client_contacts for select using (
  portal_enabled and (user_id = auth.uid() or lower(email) = lower(public.auth_email()))
);
