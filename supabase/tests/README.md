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
$PG -f supabase/migrations/0006_profitability.sql
$PG -f supabase/migrations/0007_reports.sql
$PG -f supabase/migrations/0008_media_plans.sql
$PG -f supabase/migrations/0009_hr_leave.sql
$PG -f supabase/migrations/0010_assistant.sql
$PG -f supabase/migrations/0011_automations.sql
$PG -f supabase/migrations/0012_influencers_seo.sql
$PG -f supabase/migrations/0013_plans.sql

# 3. the grants Supabase gives the `authenticated` role, so RLS is what bites
$PG -c "grant usage on schema public to authenticated, anon;
        grant all on all tables in schema public to authenticated;
        grant all on all sequences in schema public to authenticated;
        grant execute on all functions in schema public to authenticated;"

# ...then take back the two the migrations deliberately keep out of reach. The
# blanket grant above is broader than Supabase's own default privileges, and
# 0011 revokes these by name — re-granting them would hide a real check.
$PG -c "revoke all on function public.run_all_automations() from authenticated;
        revoke all on function public.run_automations_core(uuid) from authenticated;"

# 4. the assertions
psql -h 127.0.0.1 -p 5433 -U postgres -q -f supabase/tests/02_content_tests.sql
psql -h 127.0.0.1 -p 5433 -U postgres -q -f supabase/tests/03_portal_tests.sql
psql -h 127.0.0.1 -p 5433 -U postgres -q -f supabase/tests/04_invoicing_tests.sql
psql -h 127.0.0.1 -p 5433 -U postgres -q -f supabase/tests/05_assets_tests.sql
psql -h 127.0.0.1 -p 5433 -U postgres -q -f supabase/tests/06_profitability_tests.sql
psql -h 127.0.0.1 -p 5433 -U postgres -q -f supabase/tests/07_phase3_tests.sql
psql -h 127.0.0.1 -p 5433 -U postgres -q -f supabase/tests/08_assistant_tests.sql
psql -h 127.0.0.1 -p 5433 -U postgres -q -f supabase/tests/09_automation_tests.sql
psql -h 127.0.0.1 -p 5433 -U postgres -q -f supabase/tests/10_influencer_seo_tests.sql
psql -h 127.0.0.1 -p 5433 -U postgres -q -f supabase/tests/11_plans_tests.sql
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

## What 06_profitability_tests.sql covers

These check the margin maths to the rupee on a worked month, and the two decisions that most
affect the numbers.

- Cost rates are stamped on insert from the member's rate, and left null when they have none
- **A pay rise does not rewrite last month's margin**: after raising a member's rate, May's
  labour cost and margin are unchanged, while June's new entry is stamped at the new rate
- Revenue is the taxable value, not the invoice total — GST is excluded; drafts and cancelled
  invoices are not revenue
- Labour cost includes the non-billable client hour, while `billable_hours` excludes it
- Expenses total, rebilled expenses are reported separately, and total cost is labour + expenses
- Margin, margin percent and effective hourly rate; margin percent is null with no revenue
- `expected_retainer` is the monthly figure times the months the range touches (1 for a month,
  3 for a quarter)
- Unpriced time is reported as hours and costs zero, and `unpriced_contributors()` names the
  person — the report must not quietly treat free labour as profit
- **IST decides the month**: 20:00 UTC on 30 April is 01:30 IST on 1 May and counts in May;
  19:00 UTC on 31 May is 00:30 IST on 1 June and counts in June
- The agency bottom line: revenue less the cost of serving clients less overhead (time and
  expenses with no client), with overhead hours separated from client hours
- `set_hourly_cost()` can price the owner where a direct update cannot, refuses a negative rate,
  refuses a member and another agency, leaves roles untouched, and writes the activity line
- Members, freelancers, portal clients and other agencies cannot read expenses or run either
  report; a backwards date range is refused

## What 07_phase3_tests.sql covers

Reports, media planning and leave.

**Reports** — the snapshot counts only what falls in the period and excludes internal drafts;
upcoming is what sits after it; approval rounds and changes-requested are counted; ad spend
counts only rebilled expenses. The snapshot carries no hours, cost or margin keys, which is
asserted directly. A sent report cannot be rebuilt, sent twice, or edited; an unbuilt one cannot
be sent. Freelancers see no reports. The portal shows sent reports only, never drafts, never
another agency's, and gives no direct table access.

**Media planning** — a mid-month date normalises to the 1st; planned against actual per channel
per month with overspend positive and underspend negative; a channel planned but unspent shows
zero actual; a channel spent on but never planned appears with planned = 0; ad spend with no
channel buckets as `Unattributed`; a non-ad-spend expense is not counted as media spend. Staff
read, members cannot edit, other agencies see nothing and cannot call the summary.

**Leave** — a request is pending; an overlapping one is refused; more days than the dates cover
is refused; direct inserts are refused so the rules cannot be bypassed. A member cannot decide
requests. **The owner cannot approve their own leave.** A decided request cannot be decided
again. Allowances upsert rather than duplicate; `taken` counts approved only; a pending request
is reported separately and does not reduce `remaining`; cancelling returns the days. A member
cannot read everybody's balances but the team calendar is visible to all; another agency sees
nothing.

## Why mock `auth`

`auth.uid()` is the only Supabase-specific thing the policies depend on, so the
mock is a table and a one-line function that reads the request's JWT subject.
Switching user is then `set role authenticated` plus
`select set_config('request.jwt.claim.sub', '<uuid>', false)` — exactly what
PostgREST does per request.

Note that `SECURITY DEFINER` functions are owned by the superuser here, as they
are in Supabase, so they bypass RLS by design — which is why each one re-checks
the caller's role with `is_staff()` internally.

## What 08_assistant_tests.sql covers

The assistant's answers come from an API and cannot be asserted on here. What
can be is who reads whose questions, and whether the transcript holds:

- A member can open a thread, add a turn, and read both back
- A colleague in the same agency sees neither the thread nor its turns, and
  cannot write into it even knowing its id
- A MANAGER cannot read a member's thread — deliberate; only admins and owners
  can, because they answer for the agency's use of a paid API
- An owner can read a member's thread for audit but cannot write into it or
  delete it to cover tracks
- `assistant_messages` has no update policy, so a turn cannot be rewritten
- A turn whose `agency_id` does not match its thread is refused
- The other agency sees nothing, and cannot open a thread in this one

## What 09_automation_tests.sql covers

- Only a manager can create a rule or press “Run now”; a member is refused both
- A 3-day threshold acts on the tasks 5 and 9 days overdue, and ignores the one
  2 days overdue, the finished one and the one not yet due
- **The second run acts on nothing** — the `automation_events` dedupe key is
  what stops an hourly sweep repeating the same reminder forever
- A paused rule does nothing; `last_run_at` is still stamped
- A client-scoped rule ignores other clients' work
- A `create_task` rule opens the task, assigns it, and does not repeat it
- The other agency sees no rules or events and cannot run ours
- `automation_events` is append-only: no update, no delete, and an event cannot
  be forged through the API
- `run_all_automations()` and `run_automations_core()` are not callable from the
  API at all — the cron sweep has no caller to authorise

## What 10_influencer_seo_tests.sql covers

Influencers:
- A manager owns the roster; a member can read it but not change it; a
  freelancer sees nothing (they are not staff)
- `book_collab_fee()` writes one `expenses` row against the client, not marked
  rebilled, and links it back to the collaboration
- **It refuses a second booking** — otherwise one collaboration would be charged
  to the margin twice
- The booked fee shows up in `client_profitability()` as a client cost, which is
  the reason for routing it through `expenses` rather than a second money table
- A member cannot book a fee; another agency cannot book ours

SEO:
- The same keyword cannot be tracked twice for one client
- Re-checking a day corrects that day rather than adding a second row
- **A climb is a positive delta**: 42 → 11 reads as +31, and 8 → 19 as −11
- `best_position` is the best in the window, not the latest
- A keyword checked once in the window has delta null, not a reassuring zero:
  one data point is no information
- A never-checked keyword still appears, with no invented delta
- An unranked check (null position, "not in the top 100") counts as a check and
  is distinct from not having checked at all
- A position above 100 is refused outright
- Archived keywords are left out, and the other agency gets nothing

## What 11_plans_tests.sql covers

- An agency with NO subscription row is `self_hosted`: no seat limit, no client
  limit, every module. Four members on no plan is fine — this is the case that
  must not break for the agency already running the platform
- Once a subscription exists the plan applies, whatever its status: a cancelled
  subscription does not fall back to unmetered (that would make cancelling an
  upgrade) and a past-due one does not lock an agency out of its own records
- A seat beyond the plan is refused by a TRIGGER, not by the UI; deactivating
  somebody frees a seat, and `extra_seats` lets them back in
- A client beyond the plan is refused; a churned client frees its slot; a null
  limit means unlimited rather than a very large number
- **An owner cannot upgrade their own plan**, insert a subscription row, or
  start a second trial — `agency_subscription` has no write policy at all and
  `start_trial()` can only ever create a trial, once, for an owner
- `plan_usage()` returns nothing for another agency
