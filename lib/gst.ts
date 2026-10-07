/**
 * GST reference data and validation.
 *
 * The state list is mirrored in `0004_invoicing.sql` as `gst_state_name()`,
 * because the place of supply is a printed legal field and `issue_invoice()`
 * has to be able to fill it in without the app. Keep the two in step.
 */

/** Current GST state codes. 25 (Daman & Diu) and 28 (old Andhra Pradesh) are retired. */
export const GST_STATES: { code: string; name: string }[] = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
];

export function stateName(code: string | null | undefined) {
  if (!code) return null;
  return GST_STATES.find((s) => s.code === code.padStart(2, '0'))?.name ?? null;
}

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * Validates a GSTIN's shape, its state code, and its check digit.
 * The check digit is the documented mod-36 algorithm: each of the first 14
 * characters is weighted 1 or 2 alternately, each product is folded
 * (quotient + remainder over 36), and the 15th character completes the sum to a
 * multiple of 36.
 */
export function isValidGstin(raw: string | null | undefined): boolean {
  const gstin = (raw ?? '').trim().toUpperCase();
  if (!GSTIN_SHAPE.test(gstin)) return false;
  if (!GST_STATES.some((s) => s.code === gstin.slice(0, 2))) return false;

  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_CHARS.indexOf(gstin[i]);
    if (value < 0) return false;
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === gstin[14];
}

/** Explains why a GSTIN is unacceptable, for a form error. */
export function gstinProblem(raw: string | null | undefined): string | null {
  const gstin = (raw ?? '').trim().toUpperCase();
  if (!gstin) return null;
  if (gstin.length !== 15) return 'A GSTIN is exactly 15 characters.';
  if (!GSTIN_SHAPE.test(gstin)) return 'That does not look like a GSTIN (e.g. 27AAPFU0939F1ZV).';
  if (!GST_STATES.some((s) => s.code === gstin.slice(0, 2))) {
    return `"${gstin.slice(0, 2)}" is not a current GST state code.`;
  }
  if (!isValidGstin(gstin)) return 'The check digit does not match — one of the characters is wrong.';
  return null;
}

/** The Indian financial year of a date: 1 April to 31 March, as "25-26". */
export function financialYear(isoDate: string) {
  const [y, m] = isoDate.split('-').map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return `${String(startYear % 100).padStart(2, '0')}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** SAC codes a digital agency actually bills under. */
export const SAC_CODES: { code: string; label: string }[] = [
  { code: '998361', label: '998361 — Advertising services' },
  { code: '998362', label: '998362 — Buying/selling ad space on commission' },
  { code: '998365', label: '998365 — Sale of internet advertising space' },
  { code: '998313', label: '998313 — IT consulting and support' },
  { code: '998314', label: '998314 — IT design and development (websites, apps)' },
  { code: '998371', label: '998371 — Market research' },
  { code: '998399', label: '998399 — Other professional and technical services' },
  { code: '999799', label: '999799 — Other services' },
];

export const GST_RATES = [0, 5, 12, 18, 28];

export const INVOICE_STATUSES: { value: string; label: string; tone: string }[] = [
  { value: 'draft', label: 'Draft', tone: 'bg-zinc-100 text-zinc-700' },
  { value: 'issued', label: 'Issued', tone: 'bg-sky-100 text-sky-800' },
  { value: 'partly_paid', label: 'Partly paid', tone: 'bg-amber-100 text-amber-800' },
  { value: 'paid', label: 'Paid', tone: 'bg-emerald-100 text-emerald-800' },
  { value: 'cancelled', label: 'Cancelled', tone: 'bg-zinc-200 text-zinc-500' },
];

/** Amount in words, as GST invoices conventionally print. */
export function rupeesInWords(amount: number): string {
  const n = Math.round(Math.abs(amount));
  if (n === 0) return 'Zero Rupees Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const under100 = (v: number): string =>
    v < 20 ? ones[v] : `${tens[Math.floor(v / 10)]}${v % 10 ? ' ' + ones[v % 10] : ''}`;
  const under1000 = (v: number): string =>
    v < 100 ? under100(v) : `${ones[Math.floor(v / 100)]} Hundred${v % 100 ? ' ' + under100(v % 100) : ''}`;

  // Indian grouping: crore, lakh, thousand, hundred.
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${under1000(crore)} Crore`);
  if (lakh) parts.push(`${under1000(lakh)} Lakh`);
  if (thousand) parts.push(`${under1000(thousand)} Thousand`);
  if (rest) parts.push(under1000(rest));
  return `${parts.join(' ')} Rupees Only`;
}
