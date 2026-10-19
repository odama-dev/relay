/**
 * Calendar and duration math for the time log (M3). Pure and timezone-safe:
 * calendar days are "yyyy-mm-dd" strings or Dates at UTC midnight (how
 * Postgres `date` columns arrive), never local-time Dates.
 */

export type IsoDate = string; // yyyy-mm-dd

const DAY_MS = 86_400_000;

/** Date at UTC midnight → "yyyy-mm-dd". */
export function isoDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

/** "yyyy-mm-dd" → Date at UTC midnight. */
export function parseIsoDate(s: IsoDate): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function isIsoDate(s: unknown): s is IsoDate {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseIsoDate(s).getTime());
}

export function addDays(d: IsoDate, days: number): IsoDate {
  return isoDate(new Date(parseIsoDate(d).getTime() + days * DAY_MS));
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function isoWeekday(d: IsoDate): number {
  const day = parseIsoDate(d).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Monday of the week containing `d` (weeks run Monday–Sunday, M3.4). */
export function weekStart(d: IsoDate): IsoDate {
  return addDays(d, 1 - isoWeekday(d));
}

export function weekDays(start: IsoDate): IsoDate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** First day of the month containing `d`. */
export function monthStart(d: IsoDate): IsoDate {
  return `${d.slice(0, 7)}-01`;
}

export function addMonths(month: IsoDate, n: number): IsoDate {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

/** Months from `from` to `to` inclusive (both month starts). */
export function monthsBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let m = monthStart(from); m <= monthStart(to); m = addMonths(m, 1)) out.push(m);
  return out;
}

/** Today's calendar date in a time zone (defaults to the studio's, WIB). */
export function todayIn(timeZone = "Asia/Jakarta", now: Date = new Date()): IsoDate {
  // en-CA formats as yyyy-mm-dd.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** "HH:MM" wall-clock time in a time zone. */
export function timeIn(timeZone = "Asia/Jakarta", now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

/**
 * Parses what people type as a duration (M3.1) into minutes:
 * "1h 30m", "1h", "45m", "1.5", "1,5", "1:30", "90m", "2h15". A bare number is
 * hours. Returns null for anything unparseable, zero, or over 24 hours.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;

  let minutes: number | null = null;

  const clock = /^(\d{1,2}):(\d{2})$/.exec(s);
  const hm = /^(?:(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hour|hours|j|jam))?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes|mnt|menit)?)?$/.exec(s);
  const decimal = /^(\d+(?:[.,]\d+)?)$/.exec(s);

  if (clock) {
    const m = Number(clock[2]);
    if (m < 60) minutes = Number(clock[1]) * 60 + m;
  } else if (decimal) {
    minutes = Math.round(Number(decimal[1]!.replace(",", ".")) * 60);
  } else if (hm && (hm[1] || hm[2])) {
    // "45" alone was caught by `decimal`; here a trailing bare number after
    // hours ("2h15") is minutes, and "45m" is minutes.
    const hours = hm[1] ? Number(hm[1].replace(",", ".")) : 0;
    const mins = hm[2] ? Number(hm[2]) : 0;
    if (!hm[1] && !/m|min|mnt|menit/.test(s)) return null;
    minutes = Math.round(hours * 60) + mins;
  }

  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) return null;
  return minutes;
}

export type DueBucket = "overdue" | "today" | "this_week" | "later" | "none";

/** My Tasks grouping (M2.4): Overdue, Today, This week, Later, No due date. */
export function dueBucket(due: IsoDate | null, today: IsoDate): DueBucket {
  if (!due) return "none";
  if (due < today) return "overdue";
  if (due === today) return "today";
  if (due <= addDays(weekStart(today), 6)) return "this_week";
  return "later";
}

export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  this_week: "This week",
  later: "Later",
  none: "No due date",
};
