-- Minimal stand-in for the parts of Supabase that the migrations depend on.
create extension if not exists pgcrypto;

do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role anon;          exception when duplicate_object then null; end $$;
do $$ begin create role service_role;  exception when duplicate_object then null; end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'
);

-- Mirrors Supabase: auth.uid() reads the request's JWT subject.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to authenticated, anon;
grant select on auth.users to authenticated;
