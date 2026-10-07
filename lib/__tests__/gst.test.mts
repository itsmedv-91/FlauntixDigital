/**
 * Tests for lib/gst.ts — the pure GST helpers.
 * No test runner and no dependencies: `npm run test:gst` runs this through
 * Node's own TypeScript stripping (Node 22+).
 */
import assert from 'node:assert/strict';
import {
  GST_STATES,
  financialYear,
  gstinProblem,
  isValidGstin,
  rupeesInWords,
  stateName,
} from '../gst.ts';

let pass = 0;
function check(label: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ok  ${label}`);
}

// --- GSTIN check digit -------------------------------------------------------
// 27AAPFU0939F1ZV is the specimen GSTIN used throughout GST documentation, so
// accepting it confirms the mod-36 implementation matches the official one.
check('accepts the documented specimen GSTIN', () => assert.equal(isValidGstin('27AAPFU0939F1ZV'), true));
check('accepts lower case', () => assert.equal(isValidGstin('27aapfu0939f1zv'), true));
check('rejects a wrong check digit', () => assert.equal(isValidGstin('27AAPFU0939F1ZX'), false));
check('rejects another wrong check digit', () => assert.equal(isValidGstin('27AAPFU0939F1ZW'), false));
check('rejects an unknown state code', () => assert.equal(isValidGstin('99AAPFU0939F1ZV'), false));
check('rejects the retired code 25', () => assert.equal(isValidGstin('25AAPFU0939F1ZV'), false));
check('rejects a short GSTIN', () => assert.equal(isValidGstin('27AAPFU0939F1Z'), false));
check('rejects a missing Z in position 14', () => assert.equal(isValidGstin('27AAPFU0939F1AV'), false));
check('rejects empty and null', () => {
  assert.equal(isValidGstin(''), false);
  assert.equal(isValidGstin(null), false);
});

// Independently recompute the check digit for every state and confirm the
// validator agrees — catches a state slipping out of the list.
check('a valid GSTIN can be formed for every state', () => {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const state of GST_STATES) {
    const body = `${state.code}AAPFU0939F1Z`;
    let sum = 0;
    for (let i = 0; i < 14; i++) {
      const product = chars.indexOf(body[i]) * (i % 2 === 0 ? 1 : 2);
      sum += Math.floor(product / 36) + (product % 36);
    }
    const digit = chars[(36 - (sum % 36)) % 36];
    assert.equal(isValidGstin(body + digit), true, `state ${state.code}`);
  }
});
check('the state list has the 37 current codes', () => assert.equal(GST_STATES.length, 37));
check('state codes are unique', () =>
  assert.equal(new Set(GST_STATES.map((s) => s.code)).size, GST_STATES.length));

// --- form-facing explanations ------------------------------------------------
check('a blank GSTIN is not an error', () => assert.equal(gstinProblem(''), null));
check('explains a wrong length', () => assert.match(gstinProblem('27AAPFU')!, /15 characters/));
check('explains a bad state code', () => assert.match(gstinProblem('99AAPFU0939F1ZV')!, /not a current GST state/));
check('explains a bad check digit', () => assert.match(gstinProblem('27AAPFU0939F1ZX')!, /check digit/));
check('says nothing about a valid GSTIN', () => assert.equal(gstinProblem('27AAPFU0939F1ZV'), null));

// --- financial year ----------------------------------------------------------
check('1 April starts a new financial year', () => assert.equal(financialYear('2026-04-01'), '26-27'));
check('31 March is still the old one', () => assert.equal(financialYear('2026-03-31'), '25-26'));
check('January falls in the year that began in April', () =>
  assert.equal(financialYear('2026-01-15'), '25-26'));
check('handles the century rollover', () => assert.equal(financialYear('1999-04-01'), '99-00'));

// --- state names -------------------------------------------------------------
check('names a state', () => assert.equal(stateName('27'), 'Maharashtra'));
check('pads a single digit code', () => assert.equal(stateName('7'), 'Delhi'));
check('returns null for a retired code', () => assert.equal(stateName('25'), null));

// --- amount in words ---------------------------------------------------------
check('words: lakhs and thousands use Indian grouping', () =>
  assert.equal(rupeesInWords(1234567), 'Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees Only'));
check('words: a round lakh', () => assert.equal(rupeesInWords(100000), 'One Lakh Rupees Only'));
check('words: a round crore', () => assert.equal(rupeesInWords(10000000), 'One Crore Rupees Only'));
check('words: an invoice total', () =>
  assert.equal(rupeesInWords(54280), 'Fifty Four Thousand Two Hundred Eighty Rupees Only'));
check('words: zero', () => assert.equal(rupeesInWords(0), 'Zero Rupees Only'));
check('words: teens', () => assert.equal(rupeesInWords(15), 'Fifteen Rupees Only'));
check('words: rounds paisa to the rupee', () => assert.equal(rupeesInWords(99.6), 'One Hundred Rupees Only'));

console.log(`\n${pass} checks passed`);
