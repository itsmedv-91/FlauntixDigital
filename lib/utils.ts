export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

export function num(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function list(fd: FormData, key: string): string[] {
  return fd
    .getAll(key)
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function csv(fd: FormData, key: string): string[] {
  const v = str(fd, key);
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const IST = 'Asia/Kolkata';

/** Formats a YYYY-MM-DD date or an ISO timestamp as "6 Oct" (or "6 Oct 2026"). */
export function formatDate(d: string | null | undefined, withYear = false) {
  if (!d) return '—';
  const isPlainDate = d.length === 10;
  const date = new Date(isPlainDate ? d + 'T00:00:00Z' : d);
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: withYear ? 'numeric' : undefined,
    timeZone: isPlainDate ? 'UTC' : IST,
  }).format(date);
}

export function formatDateTime(d: string | null | undefined) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: IST,
  }).format(new Date(d));
}

export function formatTime(d: string | null | undefined) {
  if (!d) return '';
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: IST,
  }).format(new Date(d));
}

export function formatINR(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatMinutes(mins: number | null | undefined) {
  const m = Math.max(0, Math.round(mins ?? 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

/** Today's date in IST as YYYY-MM-DD. */
export function todayIST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(new Date());
}

/** Monday of the current week (IST) as YYYY-MM-DD, offset by whole weeks. */
export function weekStartIST(offsetWeeks = 0) {
  const today = new Date(todayIST() + 'T00:00:00Z');
  const dow = (today.getUTCDay() + 6) % 7; // Monday = 0
  today.setUTCDate(today.getUTCDate() - dow + offsetWeeks * 7);
  return today.toISOString().slice(0, 10);
}

/** The current IST month as YYYY-MM. */
export function monthIST() {
  return todayIST().slice(0, 7);
}

/** Shifts a YYYY-MM month by whole months. */
export function addMonths(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** "October 2026" for a YYYY-MM month. */
export function monthLabel(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

/** First and last day of a YYYY-MM month, as YYYY-MM-DD. */
export function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  return {
    start: `${month}-01`,
    end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10),
  };
}

export function addDays(isoDate: string, days: number) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isOverdue(due: string | null, status?: string) {
  if (!due || status === 'done') return false;
  return due < todayIST();
}

export function initials(name: string | null | undefined) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function displayName(p: { full_name?: string | null; email?: string | null } | null | undefined) {
  return p?.full_name || p?.email?.split('@')[0] || 'Unknown';
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
