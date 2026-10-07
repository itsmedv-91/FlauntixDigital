# Flauntix HQ

The internal operating platform for **Flauntix Digital** — clients, CRM, projects, tasks,
time tracking, team chat and a credentials vault in one place. Built multi-tenant from day
one (every row carries an `agency_id`), so the same codebase can later be sold to other
agencies as SaaS.

- **Stack:** Next.js 15 (App Router, Server Actions), React 19, TypeScript, Tailwind CSS 3
- **Backend:** Supabase — Postgres with row-level security, Auth, Realtime
- **Currency / timezone:** ₹ INR, Asia/Kolkata throughout

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**. Pick a region close to you
   (Mumbai `ap-south-1` for India) and save the database password somewhere safe.
2. Open **SQL Editor** → **New query** and run each migration in `supabase/migrations/`
   **in filename order** — `0001_foundation.sql`, then `0002_content.sql`. Paste one, hit
   **Run**, then the next. Every file is idempotent, so re-running one is safe.
   (With the Supabase CLI linked to the project, `supabase db push` does the whole set.)
3. Open **Authentication → URL Configuration** and set:
   - **Site URL:** `http://localhost:3000` while developing, your real domain in production
   - **Redirect URLs:** add all four —
     `http://localhost:3000/auth/callback`, `http://localhost:3000/portal/auth/callback`,
     `https://your-domain.com/auth/callback`, `https://your-domain.com/portal/auth/callback`

   Signup confirmations, password resets and invite links come back through `/auth/callback`,
   and client-portal magic links through `/portal/auth/callback`, so this step is not optional.
   Miss the portal one and clients get "invalid link" every time.
4. While testing on your own, you can turn **Authentication → Sign In / Providers → Email →
   Confirm email** off so signups log in instantly. Turn it back on before real users join.

## 2. Configure the app

```bash
cp .env.example .env.local
npm run gen:key        # prints a value for CREDENTIALS_ENCRYPTION_KEY
```

Fill in `.env.local`:

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon public key |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000`, or your deployed URL |
| `CREDENTIALS_ENCRYPTION_KEY` | output of `npm run gen:key` |

> `CREDENTIALS_ENCRYPTION_KEY` encrypts every client password in the vault (AES-256-GCM).
> Keep it out of git, and **never change it after storing credentials** — existing secrets
> can no longer be decrypted if you do. Use a different key per environment and store the
> production one in your password manager as well as in Vercel.

## 3. Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

Other scripts: `npm run typecheck`, `npm run build`, `npm run start`, and `npm test`
(the pure-helper tests — GSTIN check digit, amount in words, financial-year and FY-quarter
dates). The SQL tests live in `supabase/tests/`; see the README there.

> There is no ESLint config yet, so `npm run lint` drops into Next's interactive setup
> prompt. `next build` does not run it, so this does not affect deploys.

## 4. First run checklist

1. Visit `/signup` and create your own account — this is the agency owner.
2. You land on `/onboarding`: enter the agency name. That creates the agency, makes you its
   owner and opens a `#general` chat channel.
3. **Team → Invite someone**: add an email and a role. No emails are sent yet, so copy the
   invite link and send it over WhatsApp or email. The person signs up with *that same
   email address* and the invite attaches them to your agency.
4. Add a client, a project, then some tasks. Drag a task across the board, log time on it,
   and store a client password in the vault to confirm everything works end to end.

## Roles

| Role | What they can do |
| --- | --- |
| **Owner** | Everything, including agency settings. Cannot be demoted. |
| **Admin** | Everything, plus invites, roles and deactivating members. |
| **Manager** | Clients, CRM, projects, approvals, credentials vault, team hours. |
| **Member** | Tasks, projects, clients (read), chat, own time tracking. |
| **Freelancer** | Only tasks assigned to them, the client/project behind those tasks, and general chat channels. No CRM, no vault. |

Nobody can change their own role. These rules are enforced by Postgres row-level security,
not just by the UI — a leaked API key still cannot read another agency's data.

## Giving a client access to the portal

Clients sign in with a magic link — no passwords to reset for people who use the portal twice a
month.

1. Open the client → **Contacts** tab. Add the contact with their real email address.
2. Press **Give portal access** on that contact. Access is keyed on the email, so anyone who can
   read that inbox can sign in and see everything shared with that client — check it carefully.
3. Send them `https://your-domain.com/portal`. They enter their email and get a sign-in link.
4. Send content over with **Send to client** on a content item (or by dragging it into
   *With client* on the content board). It appears in their portal straight away.

What a client can and cannot see:

- **Can:** content in the shared statuses (with client / changes requested / approved /
  scheduled / published) for their own client record, the approval history, and comments the team
  explicitly marked *Client can see*.
- **Cannot:** drafts and internal-review content, internal notes on a post, internal comments,
  other clients, tasks, time, the CRM, the vault, or anything else in the agency. Portal users
  are not team members — they have no role and no membership, and the database enforces that
  rather than the UI.

**Email delivery matters here.** Supabase's built-in email is rate-limited to a handful of
messages per hour, and a magic link that never arrives looks like a broken portal. Configure
custom SMTP (Supabase → Project Settings → Authentication → SMTP) before putting real clients on
it. Magic links expire after an hour.

Revoking access is the same toggle: press **Revoke portal** and their next sign-in attempt is
refused. Their past approvals stay on the record.

## The asset library

Files live in one **private** Supabase Storage bucket called `assets`, with every file namespaced
by agency: `{agency_id}/{client_id}/{uuid}.{ext}`. Migration `0005_assets.sql` creates the bucket
automatically when you run it — but check **Storage → assets** exists in the Supabase dashboard
afterwards, because the migration only prints a notice if the insert is refused rather than
failing the whole run.

- **Upload** from **Assets → Add an asset**. Pick a client, or leave it as *Agency-wide* for your
  own templates and fonts. Up to 100 MB per file.
- **Uploads go from the browser straight to Storage**, never through the app server — Server
  Actions are capped at 2 MB and agencies upload video.
- **Permanent links.** Signed URLs expire within the hour, so don't copy one. Each asset has a
  **Copy link** that gives `/assets/<id>/download`, which signs a fresh URL on every click and
  re-checks who you are. That is the link to paste into a content item's *creative links*.
- **New versions.** "Upload new version" on an asset archives the old one and bumps the version
  number, so *the current logo* is unambiguous while last year's stays downloadable.
- **Archive vs delete.** Archiving hides an asset from the library and keeps the file; deleting
  removes the file for good and is managers only.

Who sees what: staff see the whole library. A **freelancer** sees agency-wide assets plus the
assets of clients they actually have a task or content item for — so they can get the logo for
the reel they're editing and nothing else. Portal clients see no assets at all.

**Not built, deliberately:** image thumbnails via Supabase's transform API (it's a paid add-on,
so the grid previews originals), bulk upload, and showing brand assets in the client portal.

## Reading the profitability report

**Profitability** answers which clients actually make money, from data already in the platform:
logged time priced at each person's cost rate, invoices, and expenses you record.

Set up once: give everyone an **hourly cost** (the panel on the right of the page does it,
including the owner's). Anyone without one has their time costed at **zero**, which makes every
margin look better than it is — the page warns you and names them rather than hiding it.

Then record costs that are not time, on the same page: ad spend you fronted, freelancer
invoices, tools, production. Leave the client empty for agency overhead.

Things worth understanding before you act on the numbers:

- **A pay rise does not change last month's margin.** Each time entry stores the cost rate it was
  logged at, so history stays put. New rates apply to new time only.
- **Non-billable client time still counts as a cost.** The billable flag decides whether you
  *could* invoice the hour, not whether it cost you — so a client who eats forty hours of
  unbillable rework shows up as unprofitable, which is the point.
- **Revenue excludes GST** and counts invoices by their issue date. Drafts and cancelled invoices
  are not revenue.
- **April's work invoiced in May lands in May.** Hours are counted when the work happened, revenue
  when you invoiced. On a single month that gap can look odd; the *under retainer* badge flags a
  client you have not billed yet, and quarter or FY views wash it out.
- **Rebilled costs net to zero.** Ad spend you front and recover appears as both a cost and (via
  the invoice line) revenue, so it doesn't flatter the margin.
- Profitability is **managers and above**, like invoices and the vault.

## Raising a GST invoice

Before the first invoice, fill in **Settings → Billing profile**: your registered legal name,
GSTIN (the check digit is verified), state, address and bank details. Issuing is blocked without
the state, and charging GST is blocked without a GSTIN. Then put each client's **GSTIN and
state** on their client record — the state is the place of supply, and it decides the tax split.

1. **Invoices → New invoice.** Pick the client and the dates. This creates a *draft*, which has
   no number yet.
2. **Add the lines.** Description, SAC code, quantity, rate, discount and GST rate. Tax is
   recalculated by the database on every change, so what you see is what prints.
3. **Issue it.** This allocates the next number for the financial year — `FLX/26-27/001` — and
   locks the invoice.
4. **Print / PDF** opens the invoice document. Use your browser's print dialog and "Save as PDF".
5. **Record payments** as they arrive; the status moves to partly paid, then paid.

Things worth knowing:

- **CGST+SGST or IGST is decided for you**, by comparing your state with the place of supply.
  Same state splits the tax in half as CGST and SGST; different states charge IGST.
- **An issued invoice cannot be edited or deleted.** GST numbering has to stay consecutive, so a
  mistake is fixed by cancelling it (the number stays reserved) and raising a new one. Only
  drafts can be deleted, which is why a number is not allocated until you issue.
- **Numbers restart each financial year** (1 April to 31 March) and are per agency. The prefix is
  capped at 6 characters so the number fits GST's 16-character limit.
- **Invoicing is managers and above**, like the credentials vault. Members, freelancers and
  portal clients cannot see invoices at all.
- **Not built, deliberately:** e-invoicing / IRN (only mandatory above ₹5 crore turnover and it
  needs a paid GSP account), credit and debit notes, GSTR-1 export, and showing invoices in the
  client portal.

This produces a compliant tax invoice for a straightforward services business. It is not tax
advice — have your CA look at your first invoice.

## Deploying to Vercel

1. Push this repository to GitHub and import it at [vercel.com/new](https://vercel.com/new).
   Framework preset: **Next.js**; no build-command changes needed.
2. Add the same four environment variables under **Settings → Environment Variables**
   (set `NEXT_PUBLIC_SITE_URL` to the production domain).
3. Deploy, then go back to Supabase → **Authentication → URL Configuration** and add the
   production **Site URL** and the `https://your-domain.com/auth/callback` redirect URL.
4. Redeploy after changing environment variables — `NEXT_PUBLIC_*` values are baked in at
   build time.

## What's in Phase 1

| Module | Highlights |
| --- | --- |
| **Dashboard** | Your tasks, overdue count, items waiting on client approval, team workload, hours this week, activity feed |
| **Tasks** | Board with drag-and-drop and list view, filters, revisions vs. scope, comments, time entries |
| **Projects** | Progress cards, per-project board, budget and time logged |
| **Clients** | Retainers and renewal warnings, brand kit, contacts, encrypted credentials vault with an access log |
| **Leads & CRM** | Pipeline kanban with value per stage, follow-up chasing, one-click convert to client |
| **Content** | Month calendar with drag-to-reschedule, production pipeline board, client approval rounds with a full audit trail, revisions vs. scope |
| **Client portal** | Magic-link sign-in for client contacts, no passwords; they approve or request changes on their own content and message the team |
| **Invoices** | GST tax invoices with per-line CGST+SGST or IGST, per-financial-year numbering, payments and balances, printable Rule 46 document |
| **Assets** | Brand library in private storage: logos, brand guides, fonts and creatives per client, versioned, with permanent links you can paste into a content item |
| **Profitability** | Per-client margin and the agency bottom line for any period, from logged time at cost, invoices and recorded expenses |
| **Time** | Week view Mon–Sun, per-day and per-client totals, timers and manual entries, team view for managers |
| **Chat** | Realtime channels grouped by general / clients / departments |
| **Team** | Members with workload and hours, roles and hourly cost, invites, deactivation |
| **Settings** | Your profile, password, agency name |

Phase 2 is complete: content calendar with client approvals, client portal, GST invoicing and
the brand/asset library. Phase 3 has started with profitability; ads data, client reports, media
planning and HR/leave are listed in `CLAUDE.md` with the design decisions already taken.

## Project layout

```
app/(app)/        signed-in pages (dashboard, tasks, projects, clients, leads, time, chat, team, settings)
app/              auth pages and routes (login, signup, invite, /auth/callback)
components/       UI primitives and the few client components (boards, timer, chat pane)
lib/actions/      server actions, one file per module
lib/              auth context, Supabase clients, crypto, types, constants, helpers
supabase/         SQL migrations, and tests that run them against a local Postgres
```

Conventions worth knowing before you change anything are in `CLAUDE.md`.

## Testing the database

`supabase/tests/` runs the migrations against a throwaway local Postgres with a mocked
Supabase `auth` schema and asserts on tenant isolation, role scoping and the approval RPCs —
no Supabase project or network needed. See `supabase/tests/README.md`. Worth running before
any schema change reaches a real database, and worth extending whenever you add a policy.
