/**
 * Tests for the IST / financial-year date helpers in lib/utils.ts.
 * Indian FY quarters (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar) are not the calendar
 * grouping, and the profitability report's periods are built from these.
 */
import assert from 'node:assert/strict';
import { addDays, addMonths, fyQuarterRange, fyRange, monthRange, weekStartIST } from '../utils.ts';

let pass = 0;
function check(label: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ok  ${label}`);
}

// --- financial year --------------------------------------------------------
check('1 April starts the financial year', () =>
  assert.deepEqual(fyRange('2026-04-01'), { start: '2026-04-01', end: '2027-03-31' }));
check('31 March is the end of the previous one', () =>
  assert.deepEqual(fyRange('2026-03-31'), { start: '2025-04-01', end: '2026-03-31' }));
check('January falls in the year that began in April', () =>
  assert.deepEqual(fyRange('2026-01-15'), { start: '2025-04-01', end: '2026-03-31' }));

// --- FY quarters -----------------------------------------------------------
check('April is Q1', () => {
  const q = fyQuarterRange('2026-04-15');
  assert.equal(q.start, '2026-04-01');
  assert.equal(q.end, '2026-06-30');
  assert.equal(q.label, 'Q1 FY26-27');
});
check('September is Q2', () => {
  const q = fyQuarterRange('2026-09-30');
  assert.equal(q.start, '2026-07-01');
  assert.equal(q.end, '2026-09-30');
  assert.equal(q.label, 'Q2 FY26-27');
});
check('December is Q3', () => {
  const q = fyQuarterRange('2026-12-01');
  assert.equal(q.start, '2026-10-01');
  assert.equal(q.end, '2026-12-31');
});
check('January is Q4 of the year that began the previous April', () => {
  const q = fyQuarterRange('2027-01-10');
  assert.equal(q.start, '2027-01-01');
  assert.equal(q.end, '2027-03-31');
  assert.equal(q.label, 'Q4 FY26-27');
});
check('March is still Q4', () => {
  const q = fyQuarterRange('2027-03-31');
  assert.equal(q.start, '2027-01-01');
  assert.equal(q.end, '2027-03-31');
});
check('every quarter is three whole months', () => {
  for (const d of ['2026-04-01', '2026-07-01', '2026-10-01', '2027-01-01', '2026-05-17', '2026-11-30']) {
    const q = fyQuarterRange(d);
    assert.equal(q.start.slice(8), '01', `${d} starts on the 1st`);
    assert.equal(addDays(q.end, 1).slice(8), '01', `${d} ends on a month end`);
    assert.equal(addMonths(q.start.slice(0, 7), 3), addMonths(q.end.slice(0, 7), 1), `${d} spans 3 months`);
  }
});

// --- month range and leap years -------------------------------------------
check('month range handles a leap February', () =>
  assert.deepEqual(monthRange('2028-02'), { start: '2028-02-01', end: '2028-02-29' }));
check('month range handles a non-leap February', () =>
  assert.deepEqual(monthRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' }));
check('month range handles a 31-day month', () =>
  assert.deepEqual(monthRange('2026-12'), { start: '2026-12-01', end: '2026-12-31' }));

// --- weeks start on Monday -------------------------------------------------
check('week starts on Monday', () => {
  const start = weekStartIST(0);
  assert.equal(new Date(`${start}T00:00:00Z`).getUTCDay(), 1);
});

console.log(`\n${pass} checks passed`);
