# Migration tests

These run the migrations against a throwaway local Postgres 16 with a minimal
stand-in for Supabase's `auth` schema, then assert on tenant isolation, role
scoping and the approval RPCs. They need no Supabase project and no network.

```bash
# 1. a scratch cluster (any Postgres 16 will do)
initdb -D /tmp/pgdata -A trust -U postgres
pg_ctl -D /tmp/pgdata -o "-p 5433 -c listen_addresses=127.0.0.1" -l /tmp/pg.log start
PG="psql -h 127.0.0.1 -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"

# 2. mock auth, then every migration in order
$PG -f supabase/tests/00_mock_auth.sql
$PG -f supabase/migrations/0001_foundation.sql
$PG -f supabase/migrations/0002_content.sql

# 3. the grants Supabase gives the `authenticated` role, so RLS is what bites
$PG -c "grant usage on schema public to authenticated, anon;
        grant all on all tables in schema public to authenticated;
        grant all on all sequences in schema public to authenticated;
        grant execute on all functions in schema public to authenticated;"

# 4. the assertions
psql -h 127.0.0.1 -p 5433 -U postgres -q -f supabase/tests/02_content_tests.sql
```

Every line should read `PASS`. The scripts are re-runnable: the test file clears
`agencies` and `auth.users` (everything else cascades) before seeding.

## What 02_content_tests.sql covers

- Two agencies cannot see each other's content, approvals or comments
- Staff see all content in their agency; freelancers only items assigned to them
- Freelancers cannot create content, and cannot modify someone else's item
- `request_content_approval`: opens round 1, moves the item to `client_approval`,
  and re-requesting reuses the open round rather than opening a second one
- `decide_content_approval`: approving moves to `scheduled` when a date is set and
  `approved` when it is not; asking for changes sets `changes_requested` and counts
  one revision; a decided round cannot be decided twice
- Only staff of the owning agency can request or decide an approval
- The `published_at` trigger stamps and clears correctly
- The constraint that a decided approval must carry a timestamp
- Comments: you cannot post as another user, and other agencies cannot read them

## Why mock `auth`

`auth.uid()` is the only Supabase-specific thing the policies depend on, so the
mock is a table and a one-line function that reads the request's JWT subject.
Switching user is then `set role authenticated` plus
`select set_config('request.jwt.claim.sub', '<uuid>', false)` — exactly what
PostgREST does per request.

Note that `SECURITY DEFINER` functions are owned by the superuser here, as they
are in Supabase, so they bypass RLS by design — which is why each one re-checks
the caller's role with `is_staff()` internally.
