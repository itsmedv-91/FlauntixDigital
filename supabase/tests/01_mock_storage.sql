-- Stand-in for the parts of Supabase Storage that 0005_assets.sql touches.
--
-- IMPORTANT about what this does and does not prove. The column shapes mirror
-- Supabase's real `storage.buckets` / `storage.objects`, so the POLICY
-- EXPRESSIONS in 0005 are genuinely exercised: who may insert an object under
-- which path prefix, and whose reads resolve through the `assets` table.
-- It does NOT test the Storage service itself — signed URL generation, the
-- upload API, MIME sniffing and `file_size_limit` all live in Supabase's
-- storage-api layer, not in Postgres, and none of that runs here.

create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null unique,
  owner              uuid,
  public             boolean default false,
  avif_autodetection boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create table if not exists storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets(id),
  name             text,
  owner            uuid,
  owner_id         text,
  metadata         jsonb,
  user_metadata    jsonb,
  path_tokens      text[] generated always as (string_to_array(name, '/')) stored,
  version          text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  last_accessed_at timestamptz default now()
);

-- Supabase ships this helper; some policies in the wild use it.
create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1:array_length(parts, 1) - 1];
end $$;

alter table storage.objects enable row level security;

grant usage on schema storage to authenticated, anon;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
