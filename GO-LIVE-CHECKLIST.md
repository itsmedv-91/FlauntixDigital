# Flauntix HQ — go-live checklist

Everything in this repo is verified by `npm run typecheck`, `npm run build` (51 routes),
`npm test` (44 helper checks) and 418 SQL assertions against a local Postgres with a mocked
`auth` schema. **None of it has ever run against a real Supabase project**, so the first
section below is not optional.

---

## 1. Stand it up (1–2 hours)

- [ ] Create a Supabase project (pick the Mumbai region — the whole app assumes IST).
- [ ] **SQL Editor → run the migrations in order, 0001 to 0013.** They are idempotent, so a
      re-run is safe, but the order is not optional.
- [ ] Storage → confirm the `assets` bucket exists and is **private** (0005 creates it).
- [ ] Auth → Settings → set the Site URL and add your deploy URL to the redirect allow list.
      Magic links and password resets bounce without this.
- [ ] Copy `.env.example` to `.env.local` and fill in:
      `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`,
      `CREDENTIALS_ENCRYPTION_KEY` (`npm run gen:key`).
- [ ] **Store the encryption key in your password manager now.** Change it later and every
      vault secret becomes undecryptable.
- [ ] `npm install && npm run dev`.

## 2. Click through it (half a day, and do it properly)

This is the one thing automated tests cannot stand in for.

- [ ] Sign up → create the agency on `/onboarding`.
- [ ] Client → project → task. Drag a task across the board. Comment on it. Start the timer,
      stop it, check the hours land on `/time`.
- [ ] Vault: save a password, reveal it, check the access log recorded the reveal.
- [ ] Leads: create one, drag it across the pipeline, convert it to a client.
- [ ] Content: create an item, drag it on the calendar, send it for approval, record a
      decision, check the approval trail reads correctly.
- [ ] Assets: upload something over 5 MB (this is the browser-direct path, which a Server
      Action could not do), then paste its download link into a content item.
- [ ] Invoices: draft → issue → part payment → full payment. Print it. **Check the printed
      per-line tax columns add up to the totals**, and that an intra-state invoice shows
      CGST+SGST while an inter-state one shows IGST.
- [ ] Chat: open two browsers, confirm a message arrives in the other without a refresh.
      (If it does not, enable Realtime for `messages` in the Supabase dashboard.)
- [ ] Invite a second person as a **freelancer** in a private window. Confirm they see only
      their own tasks and content, and no CRM, vault or billing.
- [ ] Portal: enable portal access for a client contact, sign in as them by magic link from a
      private window, approve something. **Confirm they cannot see internal notes** or
      comments that were not marked visible to the client.
- [ ] Profitability: log some time, add an expense, check the margin and that anyone with no
      cost rate is named in the warning.
- [ ] Leave: request leave as a member, approve it as a manager, confirm you **cannot approve
      your own**.
- [ ] Automations: create one, press "Run now" twice, confirm the second press does nothing.
- [ ] Install it on your phone from Chrome or Safari and open a page.

## 3. Deploy (30 minutes)

- [ ] Vercel → import the repo → add the same four env vars (plus `ANTHROPIC_API_KEY` if you
      want the assistant). Set `NEXT_PUBLIC_SITE_URL` to the real domain.
- [ ] Add the Vercel domain to the Supabase redirect allow list.
- [ ] Deploy, then re-check sign-in, a magic link and one file upload on the live URL.

## 4. Switch on the optional pieces

- [ ] **AI assistant** — get a key from console.anthropic.com, set `ANTHROPIC_API_KEY`,
      redeploy. It is metered per token; a question sends a bounded snapshot of your data.
- [ ] **Hourly automations** — Supabase → Database → Extensions → enable `pg_cron`, then
      re-run `0011_automations.sql` so it schedules the sweep. Without it the "Run now"
      button is the only trigger, which is a legitimate way to use it.
- [ ] **Agency billing details** — Settings → legal name, GSTIN, PAN, state, bank details,
      invoice prefix. Invoices are wrong without these, and an issued invoice is immutable.

---

## What is NOT built, and why

Four of these are an account somebody has to open, not code somebody has to write.

| Thing | Why not | What unblocks it |
| --- | --- | --- |
| **Invite emails** | No email provider configured | A Resend/Postmark key, or Supabase SMTP. Today an admin copies the invite link and sends it over WhatsApp. |
| **Meta / Google Ads spend** | Meta needs an app with business verification and `ads_read`; Google Ads needs a developer token behind an approval process | Those approvals. The design is in CLAUDE.md: an `ad_spend` table keyed on (agency, client, platform, month), unique so a re-sync upserts. `expenses` handles fronted ad spend meanwhile. |
| **SEO rank tracking** | Semrush, Ahrefs and DataForSEO are all paid and account-gated | A paid API key. The schema already assumes one row per keyword per date, so adding a sync changes nothing else. |
| **Subscription billing** | Razorpay needs a registered business, KYC and a live key | That account. The webhook design is at the bottom of `0013_plans.sql`; nothing above it changes. |
| **Native mobile apps** | A separate codebase plus two developer accounts and a review process | A decision to start one. The PWA installs on both platforms today. |
| **E-invoicing / IRN, credit notes, GSTR-1 export** | E-invoicing is only mandatory above ₹5 crore turnover and needs a paid GSP | Crossing that threshold, or a GSP contract. |

## Known gaps worth fixing before selling this to another agency

- [ ] **`memberships_select` is `is_member`, so any staff member can read everyone's
      `hourly_cost` through the API** even though only managers see it in the UI. RLS is
      row-level, not column-level, so the real fix is moving the column to a manager-only
      table. This is the one genuine security gap in the schema and it is written down in
      CLAUDE.md rather than quietly left.
- [ ] No rate limiting on the assistant. A member could run up an API bill. A per-agency
      daily cap on `assistant_messages` would be a small migration.
- [ ] No backups configured beyond whatever the Supabase plan gives you. Check that.
- [ ] No error reporting. Server Action failures surface to the user but go nowhere else.

## Running the tests yourself

```bash
npm run typecheck && npm run build && npm test
```

SQL suites need a local Postgres 16; the exact commands are in `supabase/tests/README.md`.
They run the migrations against a mocked `auth` schema and assert on RLS, the RPCs and the
money arithmetic — they have caught five bugs that typecheck and build both passed.
