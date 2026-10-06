# Flauntix HQ — agency platform (Phase 1: Foundation)

Internal operating platform for Flauntix Digital (6–8 person digital agency, 4–5 clients), designed multi-tenant so it can later be sold as SaaS to other agencies.

## Stack
- Next.js 15 (App Router, Server Components, Server Actions), React 19, TypeScript strict
- Supabase: Postgres + Auth + Realtime (`@supabase/ssr` cookie sessions)
- Tailwind CSS 3 (brand colours `brand-*`, `ink`, `coral-*` in `tailwind.config.ts`)
- No other runtime deps. Keep it that way unless there is a strong reason.

## Commands
- `npm install` then `npm run dev`
- `npm run typecheck` and `npm run build` must pass before calling anything done
- `npm run gen:key` prints a value for `CREDENTIALS_ENCRYPTION_KEY`
- Env vars: see `.env.example`

## Database
- Single migration: `supabase/migrations/0001_foundation.sql` (idempotent, safe to re-run).
- Every business table has `agency_id`; RLS enforces tenant isolation and roles via
  `is_member / is_staff / is_manager / is_admin` (SECURITY DEFINER helpers).
- RPCs: `create_agency(name)`, `accept_invitation(token)`, `invitation_preview(token)`.
- Roles: owner > admin > manager > member > freelancer.
  - Freelancers: only tasks assigned to them (+ the client/project of those tasks), only `kind='general'` channels, no CRM/leads/vault.
  - Vault (`credentials`): managers and above only.
  - Nobody can change their own role; owners can't be demoted.
- The migration and RLS were tested against Postgres 16 with a mocked `auth` schema: tenant isolation,
  freelancer scoping, self-promotion block and invite email matching all behave correctly.
- FK embed names used in selects: `profiles!tasks_assignee_id_fkey`, `profiles!tasks_created_by_fkey`
  (tasks has two FKs to profiles). Other tables have one FK to profiles, so plain `profiles(...)` works.
- New schema changes go in a NEW migration file (`0002_*.sql`), never edit 0001 after it's applied.

## Code conventions
- `lib/auth.ts` → `getContext()` (cached per request): user, profile, agencyId, role, `isAdmin/isManager/isStaff`, supabase client. Redirects to `/login` or `/onboarding` as needed. `getTeam()` returns agency members.
- Mutations are Server Actions in `lib/actions/*.ts`: call `getContext()`, `assertRole()` for the app-level check (RLS is the real guard), `logActivity()` for anything worth an audit line, then `revalidatePath()`.
- Bind IDs with `action.bind(null, id)`; read form fields with `str/num/list/csv` from `lib/utils.ts`.
- Pages are Server Components; client components only where needed (`'use client'`: board drag-drop, timer, reveal secret, auth forms using `useActionState`).
- Next 15: `params` and `searchParams` are Promises — always `await` them.
- UI primitives in `components/ui.tsx` (Button, LinkButton, Card, CardHeader, PageHeader, Badge, Avatar, Field, Input, Select, Textarea, EmptyState, Stat, Disclosure). `SubmitButton` (client) supports `pendingText` and `confirm`.
- Dates: IST helpers in `lib/utils.ts` (`todayIST`, `weekStartIST`, `formatDate`, `formatDateTime`). Currency: `formatINR`.
- Vault secrets: AES-256-GCM in `lib/crypto.ts` (server-only). Decrypt only via `revealCredential` (logs every reveal).

## Status

### Done
- Config: package.json, tsconfig, next/tailwind/postcss config, middleware (session refresh + auth redirects), `.env.example`
- Schema + RLS + RPCs + realtime publication for `messages`
- Auth: login, signup, forgot password, `/auth/callback`, `/auth/signout`, onboarding (create agency), invite accept page
- App shell: sidebar (role-aware nav, mobile menu), agency switcher, running-timer pill, error/loading/404
- Dashboard: stats, my tasks, waiting-on-client approvals, team workload (managers), my week, activity feed
- Tasks: board (drag-drop with optimistic update + fractional positions) and list views, filters, create form; task detail page (edit, freelancer status-only update, comments, revisions vs scope, time entries, start timer, delete)
- Projects: list (progress cards, status filter), detail (stats, board, add task, edit, delete)
- Clients: list (search/filter, retainer total, renewal warnings), new, detail with tabs: overview (brand kit), projects & tasks, contacts, credentials vault (+ access log), edit/delete
- Leads / CRM: pipeline kanban (`components/lead-board.tsx`, drag to move, value per stage), stats, "New lead" form, detail page (edit, convert to client, delete)
- Time: week view Mon–Sun (`?week=` offset), per-day bars and per-client totals, start-timer and manual-entry forms, entry list with delete, "Team" toggle for managers (billable vs non-billable)
- Chat: `/chat` redirects to #general; channel page with channels grouped by kind, "New channel" form, realtime message pane (last 100, Realtime INSERT subscription, browser-side insert, grouping, Enter to send)
- Team: members table (workload, hours this week), role + hourly cost editing, deactivate/reactivate, invites with copyable link and revoke
- Settings: profile, change password (landing page for password-reset links), agency name
- README.md: Supabase setup, env vars, first-run checklist, roles, Vercel deploy
- Server actions for every module (`leads.ts`, `time.ts`, `team.ts`, `tasks.ts`, `clients.ts`, `projects.ts`, `vault.ts`, `auth.ts`)
- `npm run typecheck` and `npm run build` both pass (24 routes)

### To do
1. Run it against a real Supabase project and click through: signup → create agency → client →
   project → task → drag on board → comment → timer → vault save/reveal → leads kanban drag →
   convert lead → chat in two browsers (check Realtime arrives) → invite a second user in a
   private window as a freelancer and confirm they only see their own task.
2. Email delivery for invites (currently the admin copies the link and shares it manually).

### Later phases (do not start without being asked)
- Phase 2: content calendar with client approvals, client portal, invoicing with GST, brand/asset library
- Phase 3: Meta/Google Ads data, automated client reports, media planning, profitability, HR/leave
- Phase 4: AI assistant, automation builder, influencer & SEO, mobile apps, multi-agency SaaS launch
Full feature list: the "Flauntix Digital Platform: Final Feature List" doc.
