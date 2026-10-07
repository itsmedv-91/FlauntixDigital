# Migration tests

These run the migrations against a throwaway local Postgres 16 with a minimal
stand-in for Supabase's `auth` schema, then assert on tenant isolation, role
scoping and the approval RPCs. They need no Supabase project and no network.

```bash
# 1. a scratch cluster (any Postgres 16 will do)
initdb -D /tmp/pgdata -A trust -U postgres
pg_ctl -D /tmp/pgdata -o "-p 5433 -c listen_addresses=127.0.0.1" -l /tmp/pg.log start
PG="psql -h 127.0.0.1 -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"

# 2. mock auth and storage, then every migration in order
$PG -f supabase/tests/00_mock_auth.sql
$PG -f supabase/tests/01_mock_storage.sql
$PG -f supabase/migrations/0001_foundation.sql
$PG -f supabase/migrations/0002_content.sql
$PG -f supabase/migrations/0003_portal.sql
$PG -f supabase/migrations/0004_invoicing.sql
$PG -f supabase/migrations/0005_assets.sql

# 3. the grants Supabase gives the `authenticated` role, so RLS is what bites
$PG -c "grant usage on schema public to authenticated, anon;
        grant all on all tables in schema public to authenticated;
        grant all on all sequences in schema public to authenticated;
        grant execute on all functions in schema public to authenticated;"

# 4. the assertions
psql -h 127.0.0.1 -p 5433 -U postgres -q -f supabase/tests/02_content_tests.sql
psql -h 127.0.0.1 -p 5433 -U postgres -q -f supabase/tests/03_portal_tests.sql
psql -h 127.0.0.1 -p 5433 -U postgres -q -f supabase/tests/04_invoicing_tests.sql
psql -h 127.0.0.1 -p 5433 -U postgres -q -f supabase/tests/05_assets_tests.sql
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

## What 03_portal_tests.sql covers

The portal lets people outside the agency sign in, so these are mostly leak tests. A portal user
is `authenticated` like anyone else — the only things between them and another client's data are
RLS and the view definitions.

- A portal contact resolves through `portal_me`, and sees only the shared statuses in
  `portal_content`: drafts, internal-review items, other clients of the same agency and other
  agencies are all invisible
- `portal_content` has no `notes` column at all, and `portal_comments` returns only
  `visible_to_client` rows — so internal notes and internal chatter cannot leak
- Direct `select` on content_items, content_approvals, content_comments, clients, tasks, leads,
  credentials, time_entries, messages, memberships and activity_log all return zero rows, which
  also proves RLS applies inside policy subqueries (the existing comment policy's `exists`
  against content_items is itself filtered)
- A portal user cannot insert a comment or update content directly — only through the RPCs
- A contact whose `portal_enabled` is false, and a signed-in stranger, get nothing at all
- `claim_portal_access()` binds `user_id` and stamps `last_portal_login`
- `portal_decide_approval`: requires a comment when asking for changes, sets `on_behalf = false`,
  credits the contact and no profile, counts a revision for changes only, writes the activity
  line the team sees, and refuses a second decision on the same round
- A client cannot decide or comment for another client of the same agency, for another agency,
  or on content never shared with them
- No regression internally: staff still see every item, both comments, and the internal notes

## What 04_invoicing_tests.sql covers

A tax invoice is a legal document, so these check the money to the paisa.

- `fy_of()` puts 1 April in the new financial year and 31 March in the old one
- Intra-state: CGST and SGST each take half the line's tax, with the odd paisa going to CGST so
  the two halves add back to the tax exactly (1,000.06 at 18% is the case that catches a naive
  split rounding both halves up)
- Inter-state: the whole tax lands in IGST, and changing the place of supply moves it across
  without changing the grand total
- Totals reconcile: taxable + tax + round off = total, and the per-line totals sum to the
  pre-rounding figure
- A 0% line attracts no tax
- Numbering: `FLX/26-27/001` then `002`; a deleted draft leaves no gap; a different financial
  year restarts at `001`; each agency has its own sequence; a prefix that would push the number
  past 16 characters is refused and leaves the invoice unnumbered
- Issuing is refused twice, with no lines, without an agency state, and when tax is charged with
  no GSTIN — but allowed at 0% tax with no GSTIN
- Payments move the status to partly_paid then paid, and removing one moves it back
- Cancelling keeps the number, records the reason, is refused twice and is refused while
  payments exist
- An issued invoice cannot be edited, deleted, or have a line added
- Members, freelancers and portal clients see no invoices at all; agencies see only their own

## What 05_assets_tests.sql covers

**Scope limit, read this first.** The storage half runs against the mock in
`01_mock_storage.sql`, whose column shapes mirror Supabase's real `storage.buckets` and
`storage.objects`. That genuinely exercises the *policy expressions* in `0005_assets.sql` — who
may write under which path prefix, and whose reads resolve through the `assets` table. It does
NOT test the Storage service: signed URL generation, the upload API, MIME sniffing and
`file_size_limit` all live in Supabase's storage-api layer, not in Postgres, and none of it runs
here.

- `path_agency()` returns the agency for a well-formed path and null for junk, an empty string, a
  null and a bare filename — and `is_staff(null)` is false, so a malformed path denies instead of
  raising
- Staff see the whole library; a freelancer sees agency-wide assets plus only the clients they
  have a task for, and a second freelancer attached through a content item instead sees the other
  half; other agencies and portal clients see nothing
- Freelancers cannot add assets, members cannot delete them, managers can; storage paths are
  unique
- Storage objects: staff can upload under their own agency prefix but not another agency's and
  not under a malformed prefix; freelancers and portal clients cannot upload at all
- Reads follow the `assets` table, and an object with no matching row is invisible to everyone —
  which is what keeps a half-finished upload from being readable
- Deleting objects is managers only
- `replace_asset()` bumps the version, links the replacement to what it replaced, archives rather
  than deletes the old row, leaves the old file downloadable, writes the activity line, and is
  refused for another agency and for a freelancer

## Why mock `auth`

`auth.uid()` is the only Supabase-specific thing the policies depend on, so the
mock is a table and a one-line function that reads the request's JWT subject.
Switching user is then `set role authenticated` plus
`select set_config('request.jwt.claim.sub', '<uuid>', false)` — exactly what
PostgREST does per request.

Note that `SECURITY DEFINER` functions are owned by the superuser here, as they
are in Supabase, so they bypass RLS by design — which is why each one re-checks
the caller's role with `is_staff()` internally.
