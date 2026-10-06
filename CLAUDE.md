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
- Server actions written for ALL modules, including ones whose pages are not built yet: `leads.ts`, `time.ts`, `team.ts` (invites, roles, deactivate, profile, password, agency, createChannel)

### To do (in this order)
1. **Leads / CRM** — `app/(app)/leads/page.tsx`: kanban by `LEAD_STAGES` (client component modelled on `components/task-board.tsx`, calling `moveLead`), totals per stage (₹), "New lead" Disclosure form (company, contact, email, phone, source from `LEAD_SOURCES`, services checkboxes, estimated value, owner, next follow-up, notes). Highlight overdue follow-ups. `app/(app)/leads/[id]/page.tsx`: edit form (`updateLead`), "Convert to client" (`convertLead`), delete. Staff can view; managers edit (RLS already enforces).
2. **Time** — `app/(app)/time/page.tsx`: week view Mon–Sun with `?week=-1/0/+1` (`weekStartIST(offset)`), totals per day and per client; start-timer form (task picker) and manual entry form (`addManualEntry`); list entries with delete. Managers get a "Team" toggle showing everyone's hours this week (+ billable vs non-billable).
3. **Chat** — `app/(app)/chat/page.tsx` redirects to first channel (general). `app/(app)/chat/[channelId]/page.tsx`: channel list grouped by kind (general / clients / departments), "New channel" form (`createChannel`), message pane = client component that loads the last 100 messages, subscribes to Supabase Realtime `postgres_changes` INSERT on `messages` filtered by `channel_id`, inserts directly from the browser client (`author_id = user.id`, `agency_id`), auto-scrolls, Enter to send / Shift+Enter newline, groups consecutive messages by author, shows names via a profiles map passed from the server.
4. **Team** — `app/(app)/team/page.tsx`: members table (avatar, name, job title, role, open tasks, hours this week, active); admins can change role + hourly cost (`changeRole`), deactivate/reactivate (`setMemberActive`), invite by email + role (`inviteMember`), see pending invites with copyable link (`inviteLink(token)`) and revoke. No email sending yet: admin copies the link and shares it (WhatsApp/email).
5. **Settings** — `app/(app)/settings/page.tsx`: profile (name, job title, skills) `updateProfile`, change password `changePassword` (also the landing page after password-reset links), agency name `updateAgency` (admins).
6. **README.md** — setup: create Supabase project → run migration in SQL editor → Auth settings (Site URL + redirect URL `<site>/auth/callback`) → env vars → `npm run dev`; deploy to Vercel with the same env vars; first user signs up and creates the agency, then invites the team.
7. `npm install && npm run typecheck && npm run build` — fix every error. Then run locally against a real Supabase project and click through: signup → create agency → client → project → task → drag on board → comment → timer → vault save/reveal → invite second user in a private window as freelancer and confirm they only see their task.

### Later phases (do not start without being asked)
- Phase 2: content calendar with client approvals, client portal, invoicing with GST, brand/asset library
- Phase 3: Meta/Google Ads data, automated client reports, media planning, profitability, HR/leave
- Phase 4: AI assistant, automation builder, influencer & SEO, mobile apps, multi-agency SaaS launch
Full feature list: the "Flauntix Digital Platform: Final Feature List" doc.
