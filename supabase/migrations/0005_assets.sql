-- =============================================================================
-- Flauntix Platform — Phase 2, part 4: brand / asset library
--
-- Files live in ONE private Supabase Storage bucket, `assets`, with every object
-- namespaced by agency:   {agency_id}/{client_id|_agency}/{uuid}.{ext}
--
-- Not a bucket per agency, which an earlier note suggested, because:
--   * creating a bucket at runtime needs elevated privileges the app does not have
--   * one set of storage policies is far easier to reason about than N
--   * Supabase's own multi-tenant guidance is to namespace by path prefix
--   * bucket-per-tenant does not survive being sold as SaaS
--
-- Storage access is derived from the `assets` table rather than duplicated:
-- the read policy just asks whether a visible `assets` row exists for that path,
-- so the per-role scoping below is inherited automatically (RLS applies inside
-- policy subqueries — 03_portal_tests.sql proves it).
--
-- Idempotent: safe to re-run. Requires 0001–0004. The storage parts no-op on a
-- plain Postgres that has no `storage` schema, so the migration stays runnable
-- against the local test harness.
-- =============================================================================

do $$ begin create type asset_kind as enum
  ('logo','brand_guide','font','colour_palette','image','video','document','template','other');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- table
create table if not exists public.assets (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies(id) on delete cascade,
  -- Null means an agency-level asset (our own logo, templates, fonts).
  client_id     uuid references public.clients(id) on delete cascade,
  project_id    uuid references public.projects(id) on delete set null,
  name          text not null check (char_length(name) between 1 and 200),
  description   text,
  kind          asset_kind not null default 'image',
  /** Path inside the private `assets` bucket. Starts with the agency id. */
  storage_path  text not null unique,
  mime_type     text,
  size_bytes    bigint check (size_bytes is null or size_bytes >= 0),
  tags          text[] not null default '{}',
  -- Simple version chain: uploading a replacement archives the row it replaces,
  -- so "the current logo" is unambiguous but old versions stay downloadable.
  version       integer not null default 1,
  replaces_id   uuid references public.assets(id) on delete set null,
  archived_at   timestamptz,
  uploaded_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists assets_agency_idx on public.assets (agency_id, archived_at);
create index if not exists assets_client_idx on public.assets (client_id, kind);
create index if not exists assets_path_idx   on public.assets (storage_path);

drop trigger if exists touch_assets on public.assets;
create trigger touch_assets before update on public.assets
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- helper
/**
 * The agency id a storage path belongs to, or null if the path is malformed.
 * Returning null rather than raising matters: a policy that casts a junk path
 * straight to uuid errors instead of denying, and is_staff(null) is false.
 */
create or replace function public.path_agency(p text) returns uuid
language sql immutable as $$
  select case
    when split_part(coalesce(p, ''), '/', 1)
         ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then split_part(p, '/', 1)::uuid
  end;
$$;

grant execute on function public.path_agency(text) to authenticated;

/** Marks the asset being replaced as archived, and carries the version forward. */
create or replace function public.replace_asset(old_id uuid, new_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare old_row assets%rowtype;
begin
  select * into old_row from assets where id = old_id;
  if not found then raise exception 'Asset not found'; end if;
  if not public.is_staff(old_row.agency_id) then raise exception 'Not allowed'; end if;

  update assets
     set version = old_row.version + 1, replaces_id = old_id
   where id = new_id and agency_id = old_row.agency_id;
  if not found then raise exception 'Replacement asset not found in this agency'; end if;

  update assets set archived_at = now() where id = old_id;

  insert into activity_log (agency_id, actor_id, entity_type, entity_id, action, meta)
  values (old_row.agency_id, (select id from profiles where id = auth.uid()), 'asset', new_id, 'replaced',
          jsonb_build_object('name', old_row.name, 'version', old_row.version + 1));
end $$;

grant execute on function public.replace_asset(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.assets enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'assets' loop
    execute format('drop policy if exists %I on public.assets', r.policyname);
  end loop;
end $$;

-- Staff see the whole library. A freelancer sees agency-level assets and the
-- assets of clients they actually have work on — the same shape as clients_select,
-- so they can get the logo for the reel they are editing and nothing else.
create policy assets_select on public.assets for select using (
  public.is_staff(agency_id)
  or (
    public.is_member(agency_id)
    and (
      client_id is null
      or exists (
        select 1 from public.tasks t
         where t.client_id = assets.client_id and t.assignee_id = auth.uid()
      )
      or exists (
        select 1 from public.content_items ci
         where ci.client_id = assets.client_id and ci.assignee_id = auth.uid()
      )
    )
  )
);
create policy assets_insert on public.assets for insert with check (public.is_staff(agency_id));
create policy assets_update on public.assets for update
  using (public.is_staff(agency_id)) with check (public.is_staff(agency_id));
create policy assets_delete on public.assets for delete using (public.is_manager(agency_id));

-- ---------------------------------------------------------------- storage
-- Everything below needs Supabase's `storage` schema. On a bare Postgres it is
-- skipped so the migration still applies.
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema not present — skipping bucket and storage policies';
    return;
  end if;

  -- A private bucket: downloads go through short-lived signed URLs.
  begin
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('assets', 'assets', false, 104857600)
    on conflict (id) do nothing;
  exception when others then
    raise notice 'could not upsert the assets bucket: %', sqlerrm;
  end;

  execute 'drop policy if exists assets_object_read on storage.objects';
  execute 'drop policy if exists assets_object_insert on storage.objects';
  execute 'drop policy if exists assets_object_update on storage.objects';
  execute 'drop policy if exists assets_object_delete on storage.objects';

  -- Reading inherits the assets table's own visibility rules.
  execute $pol$
    create policy assets_object_read on storage.objects for select using (
      bucket_id = 'assets'
      and exists (select 1 from public.assets a where a.storage_path = storage.objects.name)
    )
  $pol$;

  -- There is no assets row yet at upload time, so this keys on the path prefix.
  execute $pol$
    create policy assets_object_insert on storage.objects for insert with check (
      bucket_id = 'assets' and public.is_staff(public.path_agency(name))
    )
  $pol$;

  execute $pol$
    create policy assets_object_update on storage.objects for update
      using (bucket_id = 'assets' and public.is_staff(public.path_agency(name)))
      with check (bucket_id = 'assets' and public.is_staff(public.path_agency(name)))
  $pol$;

  execute $pol$
    create policy assets_object_delete on storage.objects for delete using (
      bucket_id = 'assets' and public.is_manager(public.path_agency(name))
    )
  $pol$;
end $$;
