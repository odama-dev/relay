import { formatDistance } from "date-fns";

/**
 * Formatting helpers. Every screen renders money, hours, percentages and
 * dates through these — never ad-hoc `toLocaleString` calls.
 *
 * Money arrives as a number (converted from Prisma's Decimal at the query
 * boundary, see lib/money.ts) together with its ISO currency code.
 */

/** Currencies without minor units in practice. */
const ZERO_DECIMAL = new Set(["IDR", "JPY"]);

const moneyFormatters = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string, compact: boolean): Intl.NumberFormat {
  const key = `${currency}:${compact}`;
  let f = moneyFormatters.get(key);
  if (!f) {
    const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
    f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: currency === "IDR" ? "code" : "narrowSymbol",
      ...(compact
        ? { notation: "compact", maximumFractionDigits: 1 }
        : { minimumFractionDigits: digits, maximumFractionDigits: digits }),
    });
    moneyFormatters.set(key, f);
  }
  return f;
}

/** "IDR 15,900,000" / "$1,250.50" / "€980.00". */
export function formatMoney(value: number, currency: string, opts?: { compact?: boolean }): string {
  if (!Number.isFinite(value)) return "—";
  // en-US prints the IDR code glued to the number ("IDR 15,900,000" needs the space).
  return moneyFormatter(currency, Boolean(opts?.compact)).format(value).replace(/^IDR\s?/, "IDR ");
}

/** Minor-unit precision of a currency (IDR 0, USD 2). */
export function currencyDecimals(currency: string): number {
  return ZERO_DECIMAL.has(currency) ? 0 : 2;
}

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatNumber(value: number): string {
  return Number.isFinite(value) ? NUMBER.format(value) : "—";
}

/** Minutes → "12.5h" (tables, totals). */
export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return `${NUMBER.format(Math.round(hours * 100) / 100)}h`;
}

/** Hours (decimal) → "12.5h". */
export function formatHoursValue(hours: number): string {
  return `${NUMBER.format(Math.round(hours * 100) / 100)}h`;
}

/** Minutes → "1h 30m" (individual entries). */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Percent from an already-scaled 0..100 value. */
export function formatPercent(value: number | null | undefined, fractionDigits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(fractionDigits)}%`;
}

type DateInput = Date | string | null | undefined;
const toDate = (v: Date | string) => (typeof v === "string" ? new Date(v) : v);

const DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const DATE_SHORT = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const DATE_LONG = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Calendar dates (due dates, entry dates, issue dates) are stored as `date`
 * and arrive as UTC midnight, so they are formatted in UTC — never shifted by
 * the viewer's time zone.
 */
export function formatDate(value: DateInput): string {
  return value ? DATE.format(toDate(value)) : "—";
}

export function formatDateShort(value: DateInput): string {
  return value ? DATE_SHORT.format(toDate(value)) : "—";
}

/** "Mon, 13 Oct". */
export function formatWeekday(value: DateInput): string {
  return value ? WEEKDAY.format(toDate(value)) : "—";
}

/** "Friday, 16 October 2026". */
export function formatDateLong(value: DateInput): string {
  return value ? DATE_LONG.format(toDate(value)) : "—";
}

/** "October 2026". */
export function formatMonth(value: DateInput): string {
  return value ? MONTH.format(toDate(value)) : "—";
}

/** "13 Oct 2026, 21:40" — a moment, shown in the viewer's time zone. */
export function formatDateTime(value: Date | string, timeZone = "Asia/Jakarta"): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(toDate(value));
}

/** "3 days ago" — activity feeds. */
export function formatRelative(value: Date | string, now: Date = new Date()): string {
  return formatDistance(toDate(value), now, { addSuffix: true });
}

/** "yyyy-MM-dd" of a stored calendar date (UTC midnight) for date inputs. */
export function toDateInputValue(value: DateInput): string {
  if (!value) return "";
  return toDate(value).toISOString().slice(0, 10);
}

/** "IN_PROGRESS" / "in_progress" → "In Progress". */
export function humanizeEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** "in_progress" → "In progress" (sentence case, for statuses). */
export function sentenceEnum(value: string): string {
  const s = value.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/*
 * Amount inputs use the English convention, like the CSV format of the PRD:
 * "," groups thousands, "." starts the decimals — "6,000,000", "1,250.50".
 */

/** Reformats what was typed: "6000000" → "6,000,000"; "1250.5" stays mid-entry. */
export function formatAmountInput(text: string, decimals = 0): string {
  const cleaned = text.replace(/[^\d.]/g, "");
  const dot = decimals > 0 ? cleaned.indexOf(".") : -1;
  const digits = (dot === -1 ? cleaned : cleaned.slice(0, dot)).replace(/\./g, "").replace(/^0+(?=\d)/, "");
  const int = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (dot === -1) return int;
  return `${int || "0"}.${cleaned.slice(dot + 1).replace(/\./g, "").slice(0, decimals)}`;
}

/** "1,250.50" → 1250.5; blank → NaN, like an empty `valueAsNumber` input. */
export function parseAmountInput(text: string): number {
  const normalized = text.replace(/,/g, "").replace(/[^\d.]/g, "");
  return normalized === "" || normalized === "." ? NaN : Number(normalized);
}

/** A form value back into input text: 1250.5 → "1,250.5". */
export function amountToInput(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const plain = decimals > 0 ? String(Math.round(value * 10 ** decimals) / 10 ** decimals) : String(Math.round(value));
  return formatAmountInput(plain, decimals);
}
