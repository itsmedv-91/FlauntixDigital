-- Behaviour tests for 0004_invoicing.sql. A tax invoice is a legal document, so
-- these check the arithmetic to the paisa, the CGST/SGST vs IGST decision, and
-- that the number sequence stays consecutive and unreusable.
\set QUIET on
\set ON_ERROR_STOP on

create or replace function t_eq(label text, actual anyelement, expected anyelement)
returns void language plpgsql as $$
begin
  if actual is not distinct from expected then
    raise notice 'PASS  % = %', label, actual;
  else
    raise notice 'FAIL  % -> got %, want %', label, actual, expected;
  end if;
end $$;

-- ----------------------------------------------------------------- seed
delete from agencies;
delete from auth.users;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@test.in',  '{"full_name":"Owner A"}'),
  ('22222222-2222-2222-2222-222222222222', 'member-a@test.in', '{"full_name":"Member A"}'),
  ('33333333-3333-3333-3333-333333333333', 'free-a@test.in',   '{"full_name":"Freelancer A"}'),
  ('99999999-9999-9999-9999-999999999991', 'priya@clienta.in', '{}'),
  ('44444444-4444-4444-4444-444444444444', 'owner-b@test.in',  '{"full_name":"Owner B"}');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select create_agency('Agency A') as agency_a \gset
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select create_agency('Agency B') as agency_b \gset

insert into memberships (agency_id, user_id, role) values
  (:'agency_a', '22222222-2222-2222-2222-222222222222', 'member'),
  (:'agency_a', '33333333-3333-3333-3333-333333333333', 'freelancer');

-- Agency A is a registered supplier in Maharashtra. Agency B has no state set.
update agencies set legal_name = 'Flauntix Digital LLP', gstin = '27AAPFU0939F1ZV',
       state_code = '27', billing_address = 'Andheri East, Mumbai',
       invoice_prefix = 'FLX', bank_details = 'HDFC ****1234'
 where id = :'agency_a';

insert into clients (id, agency_id, name, state_code, gstin, billing_address) values
  ('aaaaaaaa-0000-0000-0000-000000000001', :'agency_a', 'Mumbai Client', '27', '27AACCM1234A1Z5', 'Bandra, Mumbai'),
  ('aaaaaaaa-0000-0000-0000-000000000002', :'agency_a', 'Bengaluru Client', '29', '29AACCB5678B1Z3', 'Indiranagar, Bengaluru'),
  ('bbbbbbbb-0000-0000-0000-000000000001', :'agency_b', 'B Client', '27', null, null);

insert into client_contacts (agency_id, client_id, name, email, portal_enabled) values
  (:'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001', 'Priya Nair', 'priya@clienta.in', true);

\echo '=== financial year and state names ==='
select t_eq('1 Apr 2026 is FY 26-27',  public.fy_of('2026-04-01'), '26-27'::text);
select t_eq('31 Mar 2026 is FY 25-26', public.fy_of('2026-03-31'), '25-26'::text);
select t_eq('15 Jan 2026 is FY 25-26', public.fy_of('2026-01-15'), '25-26'::text);
select t_eq('state 27 is Maharashtra', public.gst_state_name('27'), 'Maharashtra'::text);
select t_eq('state 29 is Karnataka',   public.gst_state_name('29'), 'Karnataka'::text);
select t_eq('retired code 25 is unknown', public.gst_state_name('25'), null::text);

\echo '=== intra-state: CGST + SGST, split to the paisa ==='

insert into invoices (id, agency_id, client_id, issue_date, due_date,
                      supplier_state_code, place_of_supply_code, created_by)
values ('ff000000-0000-0000-0000-000000000001', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
        '2026-05-10', '2026-05-25', '27', '27', '11111111-1111-1111-1111-111111111111');

select t_eq('same state is not inter-state',
            (select is_interstate from invoices where id = 'ff000000-0000-0000-0000-000000000001'), false);

-- Line 1: 2 × 25,000 less 10% = 45,000.00 taxable, 18% = 8,100.00 tax.
insert into invoice_lines (agency_id, invoice_id, description, sac_code, quantity, unit_price, discount_pct, gst_rate, position)
values (:'agency_a', 'ff000000-0000-0000-0000-000000000001', 'Social media retainer', '998361', 2, 25000, 10, 18, 1);
-- Line 2: 1,000.06 at 18% = 180.0108 -> 180.01, which is an ODD number of paisa,
-- so the CGST/SGST halves must not both round to 90.01.
insert into invoice_lines (agency_id, invoice_id, description, sac_code, quantity, unit_price, gst_rate, position)
values (:'agency_a', 'ff000000-0000-0000-0000-000000000001', 'Ad spend management', '998365', 1, 1000.06, 18, 2);

select t_eq('line 1 taxable',
            (select taxable from invoice_lines where position = 1 and invoice_id = 'ff000000-0000-0000-0000-000000000001'), 45000.00);
select t_eq('line 1 CGST', (select cgst from invoice_lines where position = 1 and invoice_id = 'ff000000-0000-0000-0000-000000000001'), 4050.00);
select t_eq('line 1 SGST', (select sgst from invoice_lines where position = 1 and invoice_id = 'ff000000-0000-0000-0000-000000000001'), 4050.00);
select t_eq('line 1 IGST is zero', (select igst from invoice_lines where position = 1 and invoice_id = 'ff000000-0000-0000-0000-000000000001'), 0.00);

select t_eq('line 2 taxable', (select taxable from invoice_lines where position = 2 and invoice_id = 'ff000000-0000-0000-0000-000000000001'), 1000.06);
select t_eq('line 2 CGST takes the odd paisa',
            (select cgst from invoice_lines where position = 2 and invoice_id = 'ff000000-0000-0000-0000-000000000001'), 90.01);
select t_eq('line 2 SGST takes the rest',
            (select sgst from invoice_lines where position = 2 and invoice_id = 'ff000000-0000-0000-0000-000000000001'), 90.00);
select t_eq('line 2 halves add back to the exact tax',
            (select cgst + sgst from invoice_lines where position = 2 and invoice_id = 'ff000000-0000-0000-0000-000000000001'), 180.01);

select t_eq('taxable total', (select taxable_total from invoices where id = 'ff000000-0000-0000-0000-000000000001'), 46000.06);
select t_eq('CGST total',    (select cgst_total    from invoices where id = 'ff000000-0000-0000-0000-000000000001'), 4140.01);
select t_eq('SGST total',    (select sgst_total    from invoices where id = 'ff000000-0000-0000-0000-000000000001'), 4140.00);
select t_eq('IGST total is zero', (select igst_total from invoices where id = 'ff000000-0000-0000-0000-000000000001'), 0.00);
select t_eq('tax total',     (select tax_total     from invoices where id = 'ff000000-0000-0000-0000-000000000001'), 8280.01);
select t_eq('round off',     (select round_off     from invoices where id = 'ff000000-0000-0000-0000-000000000001'), -0.07);
select t_eq('grand total is a whole rupee',
            (select total from invoices where id = 'ff000000-0000-0000-0000-000000000001'), 54280.00);
select t_eq('totals reconcile: taxable + tax + round off = total',
            (select taxable_total + tax_total + round_off from invoices where id = 'ff000000-0000-0000-0000-000000000001'),
            (select total from invoices where id = 'ff000000-0000-0000-0000-000000000001'));
select t_eq('line totals sum to the grand total before rounding',
            (select sum(line_total) from invoice_lines where invoice_id = 'ff000000-0000-0000-0000-000000000001'), 54280.07);

\echo '=== changing the place of supply flips the tax to IGST ==='

update invoices set place_of_supply_code = '29' where id = 'ff000000-0000-0000-0000-000000000001';
select t_eq('now inter-state',
            (select is_interstate from invoices where id = 'ff000000-0000-0000-0000-000000000001'), true);
select t_eq('IGST now carries all the tax',
            (select igst_total from invoices where id = 'ff000000-0000-0000-0000-000000000001'), 8280.01);
select t_eq('CGST cleared', (select cgst_total from invoices where id = 'ff000000-0000-0000-0000-000000000001'), 0.00);
select t_eq('SGST cleared', (select sgst_total from invoices where id = 'ff000000-0000-0000-0000-000000000001'), 0.00);
select t_eq('grand total unchanged by the split',
            (select total from invoices where id = 'ff000000-0000-0000-0000-000000000001'), 54280.00);
-- Put it back to intra-state for the rest of the run.
update invoices set place_of_supply_code = '27' where id = 'ff000000-0000-0000-0000-000000000001';

\echo '=== a zero-rated line does not attract tax ==='

insert into invoices (id, agency_id, client_id, issue_date, supplier_state_code, place_of_supply_code)
values ('ff000000-0000-0000-0000-000000000009', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
        '2026-05-11', '27', '27');
insert into invoice_lines (agency_id, invoice_id, description, quantity, unit_price, gst_rate)
values (:'agency_a', 'ff000000-0000-0000-0000-000000000009', 'Reimbursed stock photos (no GST)', 1, 500, 0);
select t_eq('0% line has no tax', (select tax_total from invoices where id = 'ff000000-0000-0000-0000-000000000009'), 0.00);
select t_eq('0% line total is the taxable value',
            (select total from invoices where id = 'ff000000-0000-0000-0000-000000000009'), 500.00);

\echo '=== issuing allocates a consecutive, per-FY, per-agency number ==='

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

select t_eq('first invoice of the year',
            public.issue_invoice('ff000000-0000-0000-0000-000000000001'), 'FLX/26-27/001'::text);
reset role;
select t_eq('status is issued',
            (select status from invoices where id = 'ff000000-0000-0000-0000-000000000001'), 'issued'::invoice_status);
select t_eq('supplier snapshotted',
            (select supplier_name from invoices where id = 'ff000000-0000-0000-0000-000000000001'), 'Flauntix Digital LLP'::text);
select t_eq('recipient GSTIN snapshotted',
            (select recipient_gstin from invoices where id = 'ff000000-0000-0000-0000-000000000001'), '27AACCM1234A1Z5'::text);
select t_eq('place of supply named from its code',
            (select place_of_supply_name from invoices where id = 'ff000000-0000-0000-0000-000000000001'), 'Maharashtra'::text);
select t_eq('FY recorded', (select fy from invoices where id = 'ff000000-0000-0000-0000-000000000001'), '26-27'::text);
select t_eq('number is within the 16 character limit',
            (select char_length(number) <= 16 from invoices where id = 'ff000000-0000-0000-0000-000000000001'), true);

-- A draft that gets deleted must NOT burn a number.
insert into invoices (id, agency_id, client_id, issue_date, supplier_state_code, place_of_supply_code)
values ('ff000000-0000-0000-0000-000000000002', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
        '2026-05-12', '27', '27');
delete from invoices where id = 'ff000000-0000-0000-0000-000000000002';

insert into invoices (id, agency_id, client_id, issue_date, supplier_state_code, place_of_supply_code)
values ('ff000000-0000-0000-0000-000000000003', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000002',
        '2026-05-13', '27', '29');
insert into invoice_lines (agency_id, invoice_id, description, quantity, unit_price, gst_rate)
values (:'agency_a', 'ff000000-0000-0000-0000-000000000003', 'SEO retainer', 1, 40000, 18);

set role authenticated;
select t_eq('a deleted draft leaves no gap',
            public.issue_invoice('ff000000-0000-0000-0000-000000000003'), 'FLX/26-27/002'::text);
reset role;
select t_eq('inter-state invoice charges IGST',
            (select igst_total from invoices where id = 'ff000000-0000-0000-0000-000000000003'), 7200.00);
select t_eq('inter-state invoice charges no CGST',
            (select cgst_total from invoices where id = 'ff000000-0000-0000-0000-000000000003'), 0.00);

-- A different financial year restarts at 001.
insert into invoices (id, agency_id, client_id, issue_date, supplier_state_code, place_of_supply_code)
values ('ff000000-0000-0000-0000-000000000004', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
        '2026-03-20', '27', '27');
insert into invoice_lines (agency_id, invoice_id, description, quantity, unit_price, gst_rate)
values (:'agency_a', 'ff000000-0000-0000-0000-000000000004', 'March work', 1, 10000, 18);
set role authenticated;
select t_eq('a new financial year restarts the sequence',
            public.issue_invoice('ff000000-0000-0000-0000-000000000004'), 'FLX/25-26/001'::text);

do $$ begin
  perform public.issue_invoice('ff000000-0000-0000-0000-000000000004');
  raise notice 'FAIL  issuing twice -> no error';
exception when others then raise notice 'PASS  cannot issue the same invoice twice';
end $$;

insert into invoices (id, agency_id, client_id, issue_date, supplier_state_code, place_of_supply_code)
values ('ff000000-0000-0000-0000-000000000005', :'agency_a', 'aaaaaaaa-0000-0000-0000-000000000001',
        '2026-05-14', '27', '27');
do $$ begin
  perform public.issue_invoice('ff000000-0000-0000-0000-000000000005');
  raise notice 'FAIL  issued an invoice with no lines -> no error';
exception when others then raise notice 'PASS  cannot issue an invoice with no lines';
end $$;

\echo '=== you cannot charge GST without a GSTIN, or issue without a state ==='

reset role;
update agencies set gstin = null where id = :'agency_a';
insert into invoice_lines (agency_id, invoice_id, description, quantity, unit_price, gst_rate)
values (:'agency_a', 'ff000000-0000-0000-0000-000000000005', 'Work', 1, 1000, 18);
set role authenticated;
do $$ begin
  perform public.issue_invoice('ff000000-0000-0000-0000-000000000005');
  raise notice 'FAIL  charged GST with no GSTIN -> no error';
exception when others then raise notice 'PASS  cannot charge GST without a GSTIN';
end $$;
reset role;
-- At 0% there is no tax to charge, so an unregistered agency can still bill.
update invoice_lines set gst_rate = 0 where invoice_id = 'ff000000-0000-0000-0000-000000000005';
set role authenticated;
select t_eq('with no tax, no GSTIN is needed',
            public.issue_invoice('ff000000-0000-0000-0000-000000000005'), 'FLX/26-27/003'::text);
reset role;
update agencies set gstin = '27AAPFU0939F1ZV' where id = :'agency_a';

insert into invoices (id, agency_id, client_id, issue_date) values
  ('ff000000-0000-0000-0000-000000000006', :'agency_b', 'bbbbbbbb-0000-0000-0000-000000000001', '2026-05-15');
insert into invoice_lines (agency_id, invoice_id, description, quantity, unit_price, gst_rate)
values (:'agency_b', 'ff000000-0000-0000-0000-000000000006', 'Work', 1, 1000, 18);
set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
do $$ begin
  perform public.issue_invoice('ff000000-0000-0000-0000-000000000006');
  raise notice 'FAIL  issued without an agency state -> no error';
exception when others then raise notice 'PASS  cannot issue before the agency state is set';
end $$;

\echo '=== each agency has its own sequence ==='
reset role;
update agencies set state_code = '29', gstin = '29AAPFU0939F1Z6' where id = :'agency_b';
update invoices set supplier_state_code = '29', place_of_supply_code = '27'
 where id = 'ff000000-0000-0000-0000-000000000006';
set role authenticated;
select t_eq('agency B starts its own sequence at 001',
            public.issue_invoice('ff000000-0000-0000-0000-000000000006'), 'INV/26-27/001'::text);

\echo '=== a long prefix that would break the 16 character limit is refused ==='
reset role;
update agencies set invoice_prefix = 'FLAUNTIXDIGITAL' where id = :'agency_b';
insert into invoices (id, agency_id, client_id, issue_date, supplier_state_code, place_of_supply_code)
values ('ff000000-0000-0000-0000-000000000007', :'agency_b', 'bbbbbbbb-0000-0000-0000-000000000001',
        '2026-05-16', '29', '27');
insert into invoice_lines (agency_id, invoice_id, description, quantity, unit_price, gst_rate)
values (:'agency_b', 'ff000000-0000-0000-0000-000000000007', 'Work', 1, 1000, 18);
set role authenticated;
do $$ begin
  perform public.issue_invoice('ff000000-0000-0000-0000-000000000007');
  raise notice 'FAIL  allowed an invoice number over 16 characters -> no error';
exception when others then raise notice 'PASS  refuses a number longer than 16 characters';
end $$;
reset role;
select t_eq('the failed issue did not leave the invoice numbered',
            (select number from invoices where id = 'ff000000-0000-0000-0000-000000000007'), null::text);

\echo '=== payments move the status, and removing them moves it back ==='

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
insert into invoice_payments (id, agency_id, invoice_id, amount, paid_on)
values ('11100000-0000-0000-0000-000000000001', :'agency_a', 'ff000000-0000-0000-0000-000000000001', 20000, '2026-05-20');
select t_eq('part payment -> partly_paid',
            (select status from invoices where id = 'ff000000-0000-0000-0000-000000000001'), 'partly_paid'::invoice_status);
insert into invoice_payments (agency_id, invoice_id, amount, paid_on)
values (:'agency_a', 'ff000000-0000-0000-0000-000000000001', 34280, '2026-05-28');
select t_eq('paid in full -> paid',
            (select status from invoices where id = 'ff000000-0000-0000-0000-000000000001'), 'paid'::invoice_status);
delete from invoice_payments where invoice_id = 'ff000000-0000-0000-0000-000000000001' and amount = 34280;
select t_eq('removing a payment -> partly_paid',
            (select status from invoices where id = 'ff000000-0000-0000-0000-000000000001'), 'partly_paid'::invoice_status);

\echo '=== cancelling, never deleting, an issued invoice ==='

set role authenticated;
do $$ begin
  perform public.cancel_invoice('ff000000-0000-0000-0000-000000000001', 'test');
  raise notice 'FAIL  cancelled an invoice that has payments -> no error';
exception when others then raise notice 'PASS  cannot cancel an invoice with payments recorded';
end $$;

select public.cancel_invoice('ff000000-0000-0000-0000-000000000003', 'Client cancelled the campaign');
reset role;
select t_eq('cancelled status',
            (select status from invoices where id = 'ff000000-0000-0000-0000-000000000003'), 'cancelled'::invoice_status);
select t_eq('cancelled invoice keeps its number',
            (select number from invoices where id = 'ff000000-0000-0000-0000-000000000003'), 'FLX/26-27/002'::text);
select t_eq('cancellation reason kept',
            (select cancel_reason from invoices where id = 'ff000000-0000-0000-0000-000000000003'),
            'Client cancelled the campaign'::text);

set role authenticated;
do $$ begin
  perform public.cancel_invoice('ff000000-0000-0000-0000-000000000003', 'again');
  raise notice 'FAIL  cancelled twice -> no error';
exception when others then raise notice 'PASS  cannot cancel twice';
end $$;

\echo '=== an issued invoice is immutable and undeletable ==='

with tampered as (
  update invoices set notes = 'tampered'
   where id = 'ff000000-0000-0000-0000-000000000001' returning 1
)
select t_eq('cannot edit an issued invoice', (select count(*) from tampered)::int, 0);

with removed as (
  delete from invoices where id = 'ff000000-0000-0000-0000-000000000001' returning 1
)
select t_eq('cannot delete an issued invoice', (select count(*) from removed)::int, 0);
select t_eq('the issued invoice is still there',
            (select number from invoices where id = 'ff000000-0000-0000-0000-000000000001'), 'FLX/26-27/001'::text);

do $$ begin
  insert into invoice_lines (agency_id, invoice_id, description, quantity, unit_price, gst_rate)
  values ((select agency_id from invoices where id = 'ff000000-0000-0000-0000-000000000001'),
          'ff000000-0000-0000-0000-000000000001', 'Snuck in later', 1, 999, 18);
  raise notice 'FAIL  added a line to an issued invoice -> no error';
exception when others then raise notice 'PASS  cannot add a line to an issued invoice';
end $$;

\echo '=== billing is managers and above only ==='

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select t_eq('a member sees no invoices',  (select count(*) from invoices)::int, 0);
select t_eq('a member sees no lines',     (select count(*) from invoice_lines)::int, 0);
select t_eq('a member sees no payments',  (select count(*) from invoice_payments)::int, 0);

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select t_eq('a freelancer sees no invoices', (select count(*) from invoices)::int, 0);

select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999991', false);
select t_eq('a portal client sees no invoices', (select count(*) from invoices)::int, 0);
select t_eq('a portal client sees no lines',    (select count(*) from invoice_lines)::int, 0);

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select t_eq('agency B sees only its own invoices', (select count(*) from invoices)::int, 2);

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select t_eq('agency A manager sees only agency A invoices', (select count(*) from invoices)::int, 5);

do $$ begin
  perform public.issue_invoice('ff000000-0000-0000-0000-000000000007');
  raise notice 'FAIL  issued another agency''s invoice -> no error';
exception when others then raise notice 'PASS  cannot issue another agency''s invoice';
end $$;

reset role;
