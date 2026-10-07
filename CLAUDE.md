# Flauntix HQ — agency platform (Phase 1 done, Phase 2 in progress)

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
- Migrations, applied in order (all idempotent, safe to re-run):
  - `0001_foundation.sql` — agencies, team, CRM, projects, tasks, time, chat, vault
  - `0002_content.sql` — content calendar + client approvals
  - `0003_portal.sql` — client portal (magic-link access for client contacts)
- Tests: `supabase/tests/` runs the migrations against a local Postgres with a mocked
  `auth` schema and asserts on RLS and the RPCs. See `supabase/tests/README.md`.
  Add assertions there for any new policy or RPC.
- Every business table has `agency_id`; RLS enforces tenant isolation and roles via
  `is_member / is_staff / is_manager / is_admin` (SECURITY DEFINER helpers).
- RPCs: `create_agency(name)`, `accept_invitation(token)`, `invitation_preview(token)`,
  `request_content_approval(item_id)`, `decide_content_approval(approval_id, decision, comment, contact_id)`,
  `claim_portal_access()`, `portal_decide_approval(approval_id, decision, comment)`,
  `portal_add_comment(item_id, body)`, plus helpers `auth_email()`, `portal_client_ids()`, `is_portal_user()`.
  The two content RPCs keep an item's status and its approval round in one transaction —
  never set `content_items.status = 'client_approval'` by hand, go through the RPC.
- Roles: owner > admin > manager > member > freelancer.
  - Freelancers: only tasks assigned to them (+ the client/project of those tasks), only `kind='general'` channels, no CRM/leads/vault.
  - Vault (`credentials`): managers and above only.
  - Nobody can change their own role; owners can't be demoted.
- **Client portal (external users).** Client contacts are NOT members: no `memberships` row and no
  `member_role`, so no internal policy had to change. Access comes from
  `client_contacts.portal_enabled` + a match on `user_id` or `lower(email)`.
  - They have NO direct read access to `content_items` / `content_approvals` /
    `content_comments` — the internal policies already exclude a non-member, which the tests
    assert. They read four security-barrier views instead: `portal_me`, `portal_content`,
    `portal_approvals`, `portal_comments`.
  - The views exist because RLS is row-level, not column-level: `portal_content` simply does not
    select `content_items.notes`, so internal notes cannot reach a client even by accident, and
    `portal_comments` requires `visible_to_client`. Add a client-facing column by adding it to
    the view, never by adding a portal policy to the base table.
  - `portal_content` exposes only the shared statuses (`client_approval`, `changes_requested`,
    `approved`, `scheduled`, `published`) — drafts and internal review stay invisible.
  - Writes go through `portal_decide_approval` / `portal_add_comment` only. A client's own
    decision has `on_behalf = false`; a team member recording what the client said over WhatsApp
    goes through `decide_content_approval` and gets `on_behalf = true`.
- The migrations and RLS were tested against Postgres 16 with a mocked `auth` schema: tenant
  isolation, freelancer scoping, self-promotion block, invite email matching, the approval RPCs
  and every portal leak path all behave correctly.
- FK embed names used in selects: `profiles!tasks_assignee_id_fkey`, `profiles!tasks_created_by_fkey`
  (tasks has two FKs to profiles), `profiles!content_items_assignee_id_fkey`,
  `profiles!content_items_created_by_fkey`, `profiles!content_approvals_requested_by_fkey`,
  `profiles!content_approvals_decided_by_profile_id_fkey`. Other tables have one FK to
  profiles, so plain `profiles(...)` works. A select string built by concatenation defeats
  supabase-js inference — cast the row `as unknown as T`.
- New schema changes go in a NEW migration file (`0004_*.sql`), never edit an applied one.
- Enums need explicit casts inside a CASE (`'scheduled'::content_status`); a bare CASE
  yields text and the update fails at runtime, not at deploy time.

## Code conventions
- `lib/auth.ts` → `getContext()` (cached per request): user, profile, agencyId, role, `isAdmin/isManager/isStaff`, supabase client. Redirects to `/login` or `/onboarding` as needed. `getTeam()` returns agency members.
- Mutations are Server Actions in `lib/actions/*.ts`: call `getContext()`, `assertRole()` for the app-level check (RLS is the real guard), `logActivity()` for anything worth an audit line, then `revalidatePath()`.
- Bind IDs with `action.bind(null, id)`; read form fields with `str/num/list/csv` from `lib/utils.ts`.
- Pages are Server Components; client components only where needed (`'use client'`: board drag-drop, timer, reveal secret, auth forms using `useActionState`).
- Next 15: `params` and `searchParams` are Promises — always `await` them.
- Portal pages: `lib/portal.ts` → `getPortalContext()` (cached) is the portal's `getContext()`.
  Signed-in portal pages live in the `app/portal/(portal)/` route group so the guarding layout
  does NOT wrap `app/portal/login` — flattening that group makes `/portal/login` redirect to
  itself forever. Anything public under `/portal` must stay outside the group AND be listed in
  `PUBLIC_PATHS` in `lib/supabase/middleware.ts`.
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
- Content calendar (Phase 2): month grid with drag-to-reschedule and an unscheduled tray,
  pipeline board by status (dropping into "With client" sends for approval), filters, new/edit
  form, detail page with the approval round trail, record-decision form, comments
  (`visible_to_client`), duplicate, mark published, revisions-vs-scope warning
- Client portal (Phase 2): magic-link sign-in (no passwords), `/portal` with content grouped by
  what needs the client, approve / request-changes form writing a real approval round, client
  comment thread, per-contact access toggle on the client's Contacts tab, client comments badged
  on the internal content page
- README.md: Supabase setup, env vars, first-run checklist, roles, portal setup, Vercel deploy
- Server actions for every module (`leads.ts`, `time.ts`, `team.ts`, `tasks.ts`, `clients.ts`, `projects.ts`, `vault.ts`, `auth.ts`)
- `npm run typecheck` and `npm run build` both pass (24 routes)

### To do
1. Run against a real Supabase project and click through: signup → create agency → client →
   project → task → drag on board → comment → timer → vault save/reveal → leads kanban drag →
   convert lead → content calendar drag → send for approval → record a decision → chat in two
   browsers (check Realtime arrives) → invite a second user in a private window as a
   freelancer and confirm they only see their own task and content.
2. Email delivery for invites (currently the admin copies the link and shares it manually).

### Phase 2 (in progress)
Decisions taken with the user, to build on in this order:
1. **Content calendar + client approvals — DONE.** `0002_content.sql`, `lib/actions/content.ts`,
   month calendar with drag-to-reschedule, pipeline board, detail page with the approval trail.
2. **Client portal — DONE.** `0003_portal.sql`, `lib/portal.ts`, `lib/actions/portal.ts`,
   `app/portal/`. Magic-link sign-in, access from `client_contacts.portal_enabled`, four
   security-barrier views, two write RPCs. See the Database section for why the views exist.
3. **Invoicing with GST — NEXT.** agency GSTIN on `agencies`, GSTIN + billing state on `clients`,
   sequential per-financial-year invoice numbers, SAC codes, place of supply, and CGST+SGST
   vs IGST chosen by comparing states. Printable invoice view. No e-invoicing/IRN: that is
   only mandatory above ₹5 crore turnover and needs a paid GSP.
4. **Brand / asset library** — Supabase Storage bucket per agency, rows linking assets to
   clients, reusing `content_items.asset_urls` for the calendar side.

### Later phases (do not start without being asked)
- Phase 3: Meta/Google Ads data, automated client reports, media planning, profitability, HR/leave
- Phase 4: AI assistant, automation builder, influencer & SEO, mobile apps, multi-agency SaaS launch
Full feature list: the "Flauntix Digital Platform: Final Feature List" doc.
