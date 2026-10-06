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
2. Open **SQL Editor** → **New query**, paste the whole of
   `supabase/migrations/0001_foundation.sql`, and hit **Run**.
   The file is idempotent — re-running it is safe.
   (With the Supabase CLI linked to the project, `supabase db push` does the same thing.)
3. Open **Authentication → URL Configuration** and set:
   - **Site URL:** `http://localhost:3000` while developing, your real domain in production
   - **Redirect URLs:** add `http://localhost:3000/auth/callback` and
     `https://your-domain.com/auth/callback`

   Signup confirmation emails, password resets and invite links all come back through
   `/auth/callback`, so this step is not optional.
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

Other scripts: `npm run typecheck`, `npm run build`, `npm run start`, `npm run lint`.

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
| **Time** | Week view Mon–Sun, per-day and per-client totals, timers and manual entries, team view for managers |
| **Chat** | Realtime channels grouped by general / clients / departments |
| **Team** | Members with workload and hours, roles and hourly cost, invites, deactivation |
| **Settings** | Your profile, password, agency name |

Later phases (content calendar with client approvals, client portal, GST invoicing, ads
reporting, AI assistant) are listed in `CLAUDE.md` and are intentionally not started.

## Project layout

```
app/(app)/        signed-in pages (dashboard, tasks, projects, clients, leads, time, chat, team, settings)
app/              auth pages and routes (login, signup, invite, /auth/callback)
components/       UI primitives and the few client components (boards, timer, chat pane)
lib/actions/      server actions, one file per module
lib/              auth context, Supabase clients, crypto, types, constants, helpers
supabase/         SQL migrations
```

Conventions worth knowing before you change anything are in `CLAUDE.md`.
