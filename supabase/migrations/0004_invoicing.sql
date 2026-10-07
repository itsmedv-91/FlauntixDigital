-- =============================================================================
-- Flauntix Platform — Phase 2, part 3: invoicing with GST
--
-- A tax invoice is a legal document, so the rules that must not drift live here
-- rather than in the app:
--   * line and tax arithmetic is computed by trigger (recalc_invoice)
--   * CGST+SGST vs IGST follows from supplier state vs place of supply
--   * invoice numbers are allocated atomically, per agency, per financial year,
--     and only when an invoice is issued — so a deleted draft cannot leave a
--     gap in a sequence that has to be consecutive (Rule 46(b))
--   * an issued invoice can be cancelled but never deleted or renumbered
-- No e-invoicing / IRN: that is only mandatory above the ₹5 crore turnover
-- threshold and needs a paid GSP integration.
-- Idempotent: safe to re-run. Requires 0001–0003.
-- =============================================================================

do $$ begin create type invoice_status as enum ('draft','issued','partly_paid','paid','cancelled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- supplier
-- Everything Rule 46 wants printed about the agency issuing the invoice.
alter table public.agencies add column if not exists legal_name       text;
alter table public.agencies add column if not exists gstin            text;
alter table public.agencies add column if not exists pan              text;
alter table public.agencies add column if not exists state_code       text;
alter table public.agencies add column if not exists billing_address  text;
alter table public.agencies add column if not exists billing_email    text;
alter table public.agencies add column if not exists billing_phone    text;
alter table public.agencies add column if not exists bank_details     text;
alter table public.agencies add column if not exists invoice_prefix   text;
alter table public.agencies add column if not exists invoice_terms    text;
alter table public.agencies add column if not exists default_sac      text;
alter table public.agencies add column if not exists default_gst_rate numeric(5,2);

-- ---------------------------------------------------------------- recipient
alter table public.clients add column if not exists gstin           text;
alter table public.clients add column if not exists state_code      text;
alter table public.clients add column if not exists billing_address text;
alter table public.clients add column if not exists billing_email   text;

-- ---------------------------------------------------------------- counters
-- One row per agency per financial year. The upsert below is what makes the
-- numbering gapless under concurrency.
create table if not exists public.invoice_counters (
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  fy          text not null,
  last_number integer not null default 0,
  primary key (agency_id, fy)
);

-- ---------------------------------------------------------------- invoices
create table if not exists public.invoices (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies(id) on delete cascade,
  client_id     uuid not null references public.clients(id) on delete restrict,
  -- Null while a draft: a number is burned only on issue.
  number        text,
  fy            text,
  status        invoice_status not null default 'draft',
  issue_date    date,
  due_date      date,
  -- Snapshotted at issue: a legal document must keep what was printed on it,
  -- even if the client or agency later changes address or GSTIN.
  supplier_name    text,
  supplier_gstin   text,
  supplier_address text,
  supplier_state_code text,
  recipient_name    text,
  recipient_gstin   text,
  recipient_address text,
  place_of_supply_code text,
  place_of_supply_name text,
  is_interstate boolean generated always as
    (supplier_state_code is distinct from place_of_supply_code) stored,
  reverse_charge boolean not null default false,
  -- Totals, all maintained by recalc_invoice().
  taxable_total numeric(14,2) not null default 0,
  cgst_total    numeric(14,2) not null default 0,
  sgst_total    numeric(14,2) not null default 0,
  igst_total    numeric(14,2) not null default 0,
  tax_total     numeric(14,2) not null default 0,
  round_off     numeric(14,2) not null default 0,
  total         numeric(14,2) not null default 0,
  notes         text,
  terms         text,
  bank_details  text,
  cancelled_at  timestamptz,
  cancel_reason text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint invoices_number_per_agency unique (agency_id, number),
  -- Rule 46(b): at most 16 characters.
  constraint invoices_number_len check (number is null or char_length(number) <= 16),
  constraint invoices_issued_has_number check (
    (status = 'draft' and number is null) or (status <> 'draft' and number is not null)
  )
);

create table if not exists public.invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete set null,
  description text not null check (char_length(description) between 1 and 500),
  sac_code    text,
  quantity    numeric(12,2) not null default 1 check (quantity > 0),
  unit_price  numeric(14,2) not null default 0 check (unit_price >= 0),
  discount_pct numeric(5,2) not null default 0 check (discount_pct >= 0 and discount_pct <= 100),
  gst_rate    numeric(5,2) not null default 18 check (gst_rate >= 0 and gst_rate <= 40),
  position    integer not null default 0,
  -- Computed by recalc_invoice(), kept on the row so the printed document and
  -- the stored record can never disagree.
  taxable     numeric(14,2) not null default 0,
  cgst        numeric(14,2) not null default 0,
  sgst        numeric(14,2) not null default 0,
  igst        numeric(14,2) not null default 0,
  line_total  numeric(14,2) not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.invoice_payments (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount     numeric(14,2) not null check (amount > 0),
  paid_on    date not null default current_date,
  method     text,
  reference  text,
  note       text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists invoices_agency_idx   on public.invoices (agency_id, status, issue_date desc);
create index if not exists invoices_client_idx   on public.invoices (client_id, issue_date desc);
create index if not exists invoice_lines_idx     on public.invoice_lines (invoice_id, position);
create index if not exists invoice_payments_idx  on public.invoice_payments (invoice_id, paid_on);

drop trigger if exists touch_invoices on public.invoices;
create trigger touch_invoices before update on public.invoices
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- helpers
-- Indian financial year: 1 April to 31 March, rendered as '25-26'.
create or replace function public.fy_of(d date) returns text
language sql immutable as $$
  select case
    when extract(month from d) >= 4
      then to_char(d, 'YY') || '-' || to_char(d + interval '1 year', 'YY')
    else to_char(d - interval '1 year', 'YY') || '-' || to_char(d, 'YY')
  end;
$$;

-- GST state codes. Here as well as in lib/gst.ts because the place of supply is
-- a printed legal field: issue_invoice() must be able to fill it in without the
-- app's help. Codes 25 (Daman & Diu) and 28 (old Andhra Pradesh) are retired.
create or replace function public.gst_state_name(code text) returns text
language sql immutable as $$
  select case lpad(coalesce(code, ''), 2, '0')
    when '01' then 'Jammu and Kashmir'      when '02' then 'Himachal Pradesh'
    when '03' then 'Punjab'                 when '04' then 'Chandigarh'
    when '05' then 'Uttarakhand'            when '06' then 'Haryana'
    when '07' then 'Delhi'                  when '08' then 'Rajasthan'
    when '09' then 'Uttar Pradesh'          when '10' then 'Bihar'
    when '11' then 'Sikkim'                 when '12' then 'Arunachal Pradesh'
    when '13' then 'Nagaland'               when '14' then 'Manipur'
    when '15' then 'Mizoram'                when '16' then 'Tripura'
    when '17' then 'Meghalaya'              when '18' then 'Assam'
    when '19' then 'West Bengal'            when '20' then 'Jharkhand'
    when '21' then 'Odisha'                 when '22' then 'Chhattisgarh'
    when '23' then 'Madhya Pradesh'         when '24' then 'Gujarat'
    when '26' then 'Dadra and Nagar Haveli and Daman and Diu'
    when '27' then 'Maharashtra'            when '29' then 'Karnataka'
    when '30' then 'Goa'                    when '31' then 'Lakshadweep'
    when '32' then 'Kerala'                 when '33' then 'Tamil Nadu'
    when '34' then 'Puducherry'             when '35' then 'Andaman and Nicobar Islands'
    when '36' then 'Telangana'              when '37' then 'Andhra Pradesh'
    when '38' then 'Ladakh'                 when '97' then 'Other Territory'
    else null
  end;
$$;

grant execute on function public.gst_state_name(text) to authenticated;

/**
 * Recomputes every line and every total on an invoice.
 * Tax is worked out per line and then summed (not computed on the sum), which
 * is what keeps the printed per-line tax columns adding up to the totals.
 * Intra-state splits the line's tax into CGST and SGST, giving any odd paisa to
 * SGST so the two halves always add back to the line's tax exactly.
 */
create or replace function public.recalc_invoice(inv_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  inter boolean;
  t_taxable numeric(14,2);
  t_cgst numeric(14,2);
  t_sgst numeric(14,2);
  t_igst numeric(14,2);
  t_tax numeric(14,2);
  before_round numeric(14,2);
  rounded numeric(14,2);
begin
  select is_interstate into inter from invoices where id = inv_id;
  if not found then return; end if;

  update invoice_lines l
     set taxable = sub.taxable,
         cgst    = sub.cgst,
         sgst    = sub.sgst,
         igst    = sub.igst,
         line_total = sub.taxable + sub.cgst + sub.sgst + sub.igst
    from (
      select il.id,
             round(il.quantity * il.unit_price * (1 - il.discount_pct / 100.0), 2) as taxable,
             case when inter then 0::numeric
                  else round(round(il.quantity * il.unit_price * (1 - il.discount_pct / 100.0), 2)
                             * il.gst_rate / 100.0 / 2, 2) end as cgst,
             case when inter then 0::numeric
                  else round(round(il.quantity * il.unit_price * (1 - il.discount_pct / 100.0), 2)
                             * il.gst_rate / 100.0, 2)
                       - round(round(il.quantity * il.unit_price * (1 - il.discount_pct / 100.0), 2)
                             * il.gst_rate / 100.0 / 2, 2) end as sgst,
             case when inter then round(round(il.quantity * il.unit_price * (1 - il.discount_pct / 100.0), 2)
                             * il.gst_rate / 100.0, 2)
                  else 0::numeric end as igst
      from invoice_lines il
      where il.invoice_id = inv_id
    ) sub
   where l.id = sub.id;

  select coalesce(sum(taxable), 0), coalesce(sum(cgst), 0), coalesce(sum(sgst), 0), coalesce(sum(igst), 0)
    into t_taxable, t_cgst, t_sgst, t_igst
    from invoice_lines where invoice_id = inv_id;

  t_tax := t_cgst + t_sgst + t_igst;
  before_round := t_taxable + t_tax;
  rounded := round(before_round, 0);

  update invoices
     set taxable_total = t_taxable,
         cgst_total = t_cgst,
         sgst_total = t_sgst,
         igst_total = t_igst,
         tax_total = t_tax,
         round_off = rounded - before_round,
         total = rounded
   where id = inv_id;
end $$;

create or replace function public.invoice_lines_recalc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recalc_invoice(coalesce(new.invoice_id, old.invoice_id));
  return null;
end $$;

-- `update of <columns>` matters: recalc_invoice() writes back to invoice_lines
-- (taxable, cgst, sgst, igst, line_total), and a plain `after update` trigger
-- would call itself through that write until the stack ran out. Listing only the
-- input columns means the recalculated output never re-fires the trigger.
drop trigger if exists invoice_lines_recalc on public.invoice_lines;
create trigger invoice_lines_recalc
  after insert or delete
      or update of invoice_id, description, quantity, unit_price, discount_pct, gst_rate
  on public.invoice_lines
  for each row execute function public.invoice_lines_recalc();

-- Changing the place of supply flips the tax between IGST and CGST+SGST.
create or replace function public.invoice_place_recalc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recalc_invoice(new.id);
  return null;
end $$;

drop trigger if exists invoice_place_recalc on public.invoices;
create trigger invoice_place_recalc after update on public.invoices
  for each row
  when (old.place_of_supply_code is distinct from new.place_of_supply_code
        or old.supplier_state_code is distinct from new.supplier_state_code)
  execute function public.invoice_place_recalc();

-- ---------------------------------------------------------------- RPCs
/**
 * Turns a draft into an issued tax invoice: validates it, snapshots the parties,
 * and allocates the next number for the financial year of the issue date.
 * The upsert on invoice_counters is atomic, so two people pressing Issue at the
 * same moment get consecutive numbers rather than a duplicate or a gap.
 */
create or replace function public.issue_invoice(inv_id uuid, issue_on date default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  inv invoices%rowtype;
  ag  agencies%rowtype;
  cl  clients%rowtype;
  d date;
  the_fy text;
  seq integer;
  prefix text;
  num text;
  line_count integer;
begin
  select * into inv from invoices where id = inv_id;
  if not found then raise exception 'Invoice not found'; end if;
  if not public.is_manager(inv.agency_id) then raise exception 'Not allowed'; end if;
  if inv.status <> 'draft' then raise exception 'This invoice has already been issued'; end if;

  select count(*) into line_count from invoice_lines where invoice_id = inv_id;
  if line_count = 0 then raise exception 'Add at least one line before issuing'; end if;

  select * into ag from agencies where id = inv.agency_id;
  select * into cl from clients  where id = inv.client_id;

  d := coalesce(issue_on, inv.issue_date, current_date);
  the_fy := public.fy_of(d);

  if coalesce(trim(ag.state_code), '') = '' then
    raise exception 'Set your agency state in Settings before issuing invoices';
  end if;
  if coalesce(trim(cl.state_code), '') = '' and coalesce(trim(inv.place_of_supply_code), '') = '' then
    raise exception 'Set a place of supply (the client''s state) before issuing';
  end if;

  -- Snapshot the parties as they are today.
  update invoices set
      supplier_name       = coalesce(ag.legal_name, ag.name),
      supplier_gstin      = ag.gstin,
      supplier_address    = ag.billing_address,
      supplier_state_code = ag.state_code,
      recipient_name      = cl.name,
      recipient_gstin     = cl.gstin,
      recipient_address   = cl.billing_address,
      place_of_supply_code = coalesce(nullif(trim(inv.place_of_supply_code), ''), cl.state_code),
      place_of_supply_name = public.gst_state_name(
        coalesce(nullif(trim(inv.place_of_supply_code), ''), cl.state_code)),
      bank_details        = coalesce(inv.bank_details, ag.bank_details),
      terms               = coalesce(inv.terms, ag.invoice_terms),
      issue_date          = d,
      fy                  = the_fy
    where id = inv_id;

  -- Re-read so the recalculated, snapshotted row decides the GSTIN check.
  perform public.recalc_invoice(inv_id);
  select * into inv from invoices where id = inv_id;

  if inv.tax_total > 0 and coalesce(trim(inv.supplier_gstin), '') = '' then
    raise exception 'You cannot charge GST without a GSTIN — set one in Settings, or set every line to 0%%';
  end if;

  insert into invoice_counters (agency_id, fy, last_number)
  values (inv.agency_id, the_fy, 1)
  on conflict (agency_id, fy) do update set last_number = invoice_counters.last_number + 1
  returning last_number into seq;

  prefix := upper(coalesce(nullif(trim(ag.invoice_prefix), ''), 'INV'));
  num := prefix || '/' || the_fy || '/' || lpad(seq::text, 3, '0');
  if char_length(num) > 16 then
    raise exception 'Invoice number "%" is longer than the 16 characters GST allows — shorten the prefix in Settings', num;
  end if;

  update invoices set number = num, status = 'issued' where id = inv_id;

  insert into activity_log (agency_id, actor_id, entity_type, entity_id, action, meta)
  values (inv.agency_id, (select id from profiles where id = auth.uid()), 'invoice', inv_id, 'issued',
          jsonb_build_object('number', num, 'total', inv.total, 'client', cl.name));
  return num;
end $$;

/** Recomputes paid/partly_paid/issued from the payments on an invoice. */
create or replace function public.refresh_invoice_payment_status(inv_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  inv invoices%rowtype;
  paid numeric(14,2);
begin
  select * into inv from invoices where id = inv_id;
  if not found or inv.status in ('draft','cancelled') then return; end if;

  select coalesce(sum(amount), 0) into paid from invoice_payments where invoice_id = inv_id;

  update invoices
     set status = case
                    when paid <= 0 then 'issued'::invoice_status
                    when paid < inv.total then 'partly_paid'::invoice_status
                    else 'paid'::invoice_status
                  end
   where id = inv_id;
end $$;

create or replace function public.invoice_payments_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_invoice_payment_status(coalesce(new.invoice_id, old.invoice_id));
  return null;
end $$;

drop trigger if exists invoice_payments_touch on public.invoice_payments;
create trigger invoice_payments_touch after insert or update or delete on public.invoice_payments
  for each row execute function public.invoice_payments_touch();

/**
 * Cancels an issued invoice. The number is deliberately NOT reused and the row
 * is not deleted — the sequence has to stay consecutive and auditable.
 */
create or replace function public.cancel_invoice(inv_id uuid, reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare inv invoices%rowtype;
begin
  select * into inv from invoices where id = inv_id;
  if not found then raise exception 'Invoice not found'; end if;
  if not public.is_manager(inv.agency_id) then raise exception 'Not allowed'; end if;
  if inv.status = 'draft' then raise exception 'A draft can simply be deleted'; end if;
  if inv.status = 'cancelled' then raise exception 'Already cancelled'; end if;
  if exists (select 1 from invoice_payments where invoice_id = inv_id) then
    raise exception 'This invoice has payments recorded against it — delete those first';
  end if;

  update invoices
     set status = 'cancelled', cancelled_at = now(), cancel_reason = reason
   where id = inv_id;

  insert into activity_log (agency_id, actor_id, entity_type, entity_id, action, meta)
  values (inv.agency_id, (select id from profiles where id = auth.uid()), 'invoice', inv_id, 'cancelled',
          jsonb_build_object('number', inv.number, 'reason', reason));
end $$;

grant execute on function public.fy_of(date) to authenticated;
grant execute on function public.issue_invoice(uuid, date) to authenticated;
grant execute on function public.cancel_invoice(uuid, text) to authenticated;
grant execute on function public.recalc_invoice(uuid) to authenticated;
grant execute on function public.refresh_invoice_payment_status(uuid) to authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.invoices         enable row level security;
alter table public.invoice_lines    enable row level security;
alter table public.invoice_payments enable row level security;
alter table public.invoice_counters enable row level security;

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('invoices','invoice_lines','invoice_payments','invoice_counters') loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Billing is managers and above, like the credentials vault. Members, freelancers
-- and portal users get nothing.
create policy invoices_select on public.invoices for select using (public.is_manager(agency_id));
create policy invoices_insert on public.invoices for insert with check (public.is_manager(agency_id));
-- An issued invoice is immutable except through the RPCs (which are definer).
create policy invoices_update on public.invoices for update
  using (public.is_manager(agency_id) and status = 'draft')
  with check (public.is_manager(agency_id));
create policy invoices_delete on public.invoices for delete
  using (public.is_manager(agency_id) and status = 'draft');

create policy invoice_lines_select on public.invoice_lines for select using (public.is_manager(agency_id));
create policy invoice_lines_write on public.invoice_lines for all
  using (
    public.is_manager(agency_id)
    and exists (select 1 from public.invoices i where i.id = invoice_lines.invoice_id and i.status = 'draft')
  )
  with check (
    public.is_manager(agency_id)
    and exists (select 1 from public.invoices i where i.id = invoice_lines.invoice_id and i.status = 'draft')
  );

create policy invoice_payments_select on public.invoice_payments for select using (public.is_manager(agency_id));
create policy invoice_payments_write on public.invoice_payments for all
  using (public.is_manager(agency_id)) with check (public.is_manager(agency_id));

-- Counters are maintained only by issue_invoice(); nobody edits them by hand.
create policy invoice_counters_select on public.invoice_counters for select using (public.is_manager(agency_id));
