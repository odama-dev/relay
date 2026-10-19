import { addDays, addMonths, isoWeekday, monthStart, parseIsoDate, type IsoDate } from "@/lib/time/pure";

/**
 * C-Level dashboard math (PRD/Clevel dashboard.md). Pure and unit-tested —
 * the queries in lib/clevel/queries.ts feed it rows, the screen only renders.
 *
 * Every metric runs over a *window*: the selected period up to today (a
 * period that's still running is compared on the days that have passed).
 */

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Periods (§2.2)
// ---------------------------------------------------------------------------

export const PERIOD_KINDS = ["month", "last_month", "quarter", "ytd", "custom"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

export const PERIOD_LABELS: Record<PeriodKind, string> = {
  month: "This month",
  last_month: "Last month",
  quarter: "This quarter",
  ytd: "Year to date",
  custom: "Custom",
};

export type Window = { start: IsoDate; end: IsoDate };
export type Period = Window & {
  kind: PeriodKind;
  /** The period's full end (e.g. the last day of this month); `end` stops at today. */
  fullEnd: IsoDate;
};

export const lastDayOfMonth = (d: IsoDate): IsoDate => addDays(addMonths(monthStart(d), 1), -1);
const minDate = (a: IsoDate, b: IsoDate) => (a < b ? a : b);
const maxDate = (a: IsoDate, b: IsoDate) => (a > b ? a : b);

/** Calendar days in [start, end], inclusive. 0 when the range is empty. */
export function daysIn(w: Window): number {
  if (w.end < w.start) return 0;
  return Math.round((parseIsoDate(w.end).getTime() - parseIsoDate(w.start).getTime()) / DAY_MS) + 1;
}

export function overlap(a: Window, b: Window): Window | null {
  const w = { start: maxDate(a.start, b.start), end: minDate(a.end, b.end) };
  return w.end < w.start ? null : w;
}

export function resolvePeriod(kind: PeriodKind, today: IsoDate, custom?: { from?: string; to?: string }): Period {
  const year = today.slice(0, 4);
  let start: IsoDate;
  let fullEnd: IsoDate;
  switch (kind) {
    case "last_month":
      start = addMonths(monthStart(today), -1);
      fullEnd = lastDayOfMonth(start);
      break;
    case "quarter": {
      const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
      start = `${year}-${String(q * 3 + 1).padStart(2, "0")}-01`;
      fullEnd = lastDayOfMonth(addMonths(start, 2));
      break;
    }
    case "ytd":
      start = `${year}-01-01`;
      fullEnd = `${year}-12-31`;
      break;
    case "custom":
      if (custom?.from && custom?.to && custom.from <= custom.to) {
        start = custom.from;
        fullEnd = custom.to;
        break;
      }
      return resolvePeriod("month", today);
    default:
      start = monthStart(today);
      fullEnd = lastDayOfMonth(today);
  }
  const end = minDate(fullEnd, today);
  return { kind, start, end: end < start ? start : end, fullEnd };
}

/**
 * The comparison window: the same length right before. A calendar period
 * still running (this month / quarter / year) is compared with the same
 * number of days at the start of the previous one.
 */
export function previousWindow(p: Period): Window {
  const length = daysIn(p);
  let start: IsoDate;
  if (p.kind === "month" || p.kind === "last_month") start = addMonths(monthStart(p.start), -1);
  else if (p.kind === "quarter") start = addMonths(p.start, -3);
  else if (p.kind === "ytd") start = `${Number(p.start.slice(0, 4)) - 1}-01-01`;
  else start = addDays(p.start, -length);
  return { start, end: addDays(start, length - 1) };
}

/** Month starts touching a window. */
export function monthsOf(w: Window): IsoDate[] {
  const out: IsoDate[] = [];
  for (let m = monthStart(w.start); m <= w.end; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** The last `n` month starts ending with the month of `d`. */
export function lastMonths(d: IsoDate, n: number): IsoDate[] {
  return Array.from({ length: n }, (_, i) => addMonths(monthStart(d), i - n + 1));
}

/** Calendar window of one month, cut at `today`. */
export function monthWindow(month: IsoDate, today: IsoDate): Window {
  return { start: month, end: minDate(lastDayOfMonth(month), today) };
}

// ---------------------------------------------------------------------------
// History lookups, pro-rata
// ---------------------------------------------------------------------------

/** The row in force on `day`: latest effective_from on or before it (§3.1, §3.2). */
export function effectiveAt<T extends { effectiveFrom: IsoDate }>(rows: T[], day: IsoDate): T | null {
  let best: T | null = null;
  for (const r of rows) if (r.effectiveFrom <= day && (!best || r.effectiveFrom > best.effectiveFrom)) best = r;
  return best;
}

export type Employment = { activeFrom: IsoDate; activeTo: IsoDate | null };

/**
 * A person's cost over a window (§4.3), pro-rata per day: each day counts
 * the monthly cost in force that day ÷ the days in its month, while the
 * person was active. A cost that starts mid-month counts from that day.
 * Null when no cost row applies at all.
 */
export function personCost(costs: { effectiveFrom: IsoDate; monthlyCostIdr: number }[], employment: Employment, w: Window): number | null {
  const active = overlap(w, { start: employment.activeFrom, end: employment.activeTo ?? "9999-12-31" });
  if (!active) return 0;
  let total = 0;
  let found = false;
  for (let d = active.start; d <= active.end; d = addDays(d, 1)) {
    const row = effectiveAt(costs, d);
    if (!row) continue;
    found = true;
    total += row.monthlyCostIdr / daysIn({ start: monthStart(d), end: lastDayOfMonth(d) });
  }
  return found ? round2(total) : costs.length > 0 ? 0 : null;
}

export type CapacityOverride = { start: IsoDate; end: IsoDate; availableHours: number };

/** Workdays (ISO weekdays in `workdays`) in a window. */
export function workdaysIn(w: Window, workdays: number[]): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = w.start; d <= w.end; d = addDays(d, 1)) if (workdays.includes(isoWeekday(d))) out.push(d);
  return out;
}

/**
 * Available hours in a window (§3.2): weekly hours spread over the studio's
 * workdays, pro-rata per workday, while employed. Days covered by an
 * override take the override's hours instead, spread over its own workdays.
 * Null when the person has no capacity row at all.
 */
export function availableHours(
  capacity: { effectiveFrom: IsoDate; weeklyHours: number }[],
  overrides: CapacityOverride[],
  employment: Employment,
  w: Window,
  workdays: number[],
): number | null {
  const active = overlap(w, { start: employment.activeFrom, end: employment.activeTo ?? "9999-12-31" });
  if (!active) return 0;
  const perWeek = workdays.length || 5;
  let total = 0;
  let found = false;
  for (const day of workdaysIn(active, workdays)) {
    const o = overrides.find((x) => x.start <= day && day <= x.end);
    if (o) {
      found = true;
      total += o.availableHours / Math.max(1, workdaysIn({ start: o.start, end: o.end }, workdays).length);
      continue;
    }
    const row = effectiveAt(capacity, day);
    if (!row) continue;
    found = true;
    total += row.weeklyHours / perWeek;
  }
  return found || capacity.length > 0 ? round2(total) : null;
}

// ---------------------------------------------------------------------------
// Targets & comparisons (§2.2, §2.4, §3.4)
// ---------------------------------------------------------------------------

export type RevenueTargetRow = { year: number; month: number | null; targetIdr: number };

/** Target of one month: its own row, else the yearly target ÷ 12; null without either. */
export function monthTarget(rows: RevenueTargetRow[], month: IsoDate): number | null {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const own = rows.find((r) => r.year === y && r.month === m);
  if (own) return own.targetIdr;
  const yearly = rows.find((r) => r.year === y && r.month === null);
  return yearly ? yearly.targetIdr / 12 : null;
}

/** Target for a window: monthly targets summed, pro-rata by days for partial months. */
export function windowTarget(rows: RevenueTargetRow[], w: Window): number | null {
  let total = 0;
  let found = false;
  for (const m of monthsOf(w)) {
    const t = monthTarget(rows, m);
    if (t === null) continue;
    found = true;
    const month = { start: m, end: lastDayOfMonth(m) };
    total += t * (daysIn(overlap(w, month)!) / daysIn(month));
  }
  return found ? round2(total) : null;
}

export type TargetStatus = "good" | "watch" | "bad";
export type StatusThresholds = { good: number; watch: number };
export const DEFAULT_STATUS_THRESHOLDS: StatusThresholds = { good: 100, watch: 80 };

/** % of target and its status: Good ≥ 100%, Watch 80–99%, Bad < 80% (defaults). */
export function targetStatus(actual: number, target: number | null, t: StatusThresholds = DEFAULT_STATUS_THRESHOLDS) {
  if (target === null || target <= 0) return null;
  const pct = round2((actual / target) * 100);
  const status: TargetStatus = pct >= t.good ? "good" : pct >= t.watch ? "watch" : "bad";
  return { pct, status };
}

/** Change vs the previous window, absolute and in % (null when the previous was 0). */
export function delta(current: number, previous: number) {
  return { change: round2(current - previous), pct: previous === 0 ? null : round2(((current - previous) / Math.abs(previous)) * 100) };
}

// ---------------------------------------------------------------------------
// Receivables (§4.2) & FX estimates (§2.3, §3.6)
// ---------------------------------------------------------------------------

export const AGING_BUCKETS = ["not_due", "late_1_30", "late_31_60", "late_60_plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export const AGING_LABELS: Record<AgingBucket, string> = {
  not_due: "Not due yet",
  late_1_30: "1–30 days late",
  late_31_60: "31–60 days late",
  late_60_plus: "Over 60 days late",
};

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / DAY_MS);
}

export function agingBucket(due: IsoDate, today: IsoDate): AgingBucket {
  const late = daysBetween(due, today);
  if (late <= 0) return "not_due";
  if (late <= 30) return "late_1_30";
  if (late <= 60) return "late_31_60";
  return "late_60_plus";
}

/** IDR estimate of a foreign amount; IDR passes through; null without a rate. */
export function estimateIdr(amount: number, currency: string, rates: Map<string, number>): number | null {
  if (currency === "IDR") return amount;
  const rate = rates.get(currency);
  return rate ? round2(amount * rate) : null;
}

// ---------------------------------------------------------------------------
// Margin (§4.3, §5.4)
// ---------------------------------------------------------------------------

export function margin(revenue: number, costs: number) {
  const value = round2(revenue - costs);
  return { value, pct: revenue > 0 ? round2((value / revenue) * 100) : null };
}

/** Share of revenue from the top 1 and top 3 clients (§4.4). */
export function concentration(revenueByClient: number[]) {
  const total = revenueByClient.reduce((s, v) => s + v, 0);
  const sorted = [...revenueByClient].sort((a, b) => b - a);
  if (total <= 0) return { top1: null, top3: null };
  return { top1: round2((sorted[0]! / total) * 100), top3: round2((sorted.slice(0, 3).reduce((s, v) => s + v, 0) / total) * 100) };
}

// ---------------------------------------------------------------------------
// Project attention (§3.8, §5.5)
// ---------------------------------------------------------------------------

export type AttentionRules = {
  budgetPct: { enabled: boolean; value: number };
  overdueTasks: { enabled: boolean; value: number };
  lateInvoiceDays: { enabled: boolean; value: number };
  marginPct: { enabled: boolean; value: number };
};

export const DEFAULT_ATTENTION_RULES: AttentionRules = {
  budgetPct: { enabled: true, value: 100 },
  overdueTasks: { enabled: true, value: 3 },
  lateInvoiceDays: { enabled: true, value: 14 },
  marginPct: { enabled: true, value: 20 },
};

export function attentionReasons(
  p: { budgetPct: number | null; overdueTasks: number; maxDaysLate: number; marginPct: number | null },
  rules: AttentionRules,
): string[] {
  const out: string[] = [];
  if (rules.budgetPct.enabled && p.budgetPct !== null && p.budgetPct > rules.budgetPct.value) out.push(`Over budget ${Math.round(p.budgetPct)}%`);
  if (rules.overdueTasks.enabled && p.overdueTasks > rules.overdueTasks.value) out.push(`${p.overdueTasks} overdue tasks`);
  if (rules.lateInvoiceDays.enabled && p.maxDaysLate > rules.lateInvoiceDays.value) out.push(`Payment ${p.maxDaysLate} days late`);
  // Margin only counts when cost data exists (marginPct is null otherwise).
  if (rules.marginPct.enabled && p.marginPct !== null && p.marginPct < rules.marginPct.value) out.push(`Margin ${Math.round(p.marginPct)}%`);
  return out;
}

// ---------------------------------------------------------------------------
// Utilization (§6)
// ---------------------------------------------------------------------------

export type UtilizationStatus = "overload" | "on_target" | "under";

export function utilizationPct(billableHours: number, availableHours: number | null): number | null {
  if (!availableHours || availableHours <= 0) return null;
  return round2((billableHours / availableHours) * 100);
}

/** Overload above target + band (or logged more than available), under below target − band (§6.3). */
export function utilizationStatus(p: { utilization: number | null; target: number; logged: number; available: number | null }, band = 15): UtilizationStatus | null {
  if (p.available !== null && p.available > 0 && p.logged > p.available) return "overload";
  if (p.utilization === null) return null;
  if (p.utilization > p.target + band) return "overload";
  if (p.utilization < p.target - band) return "under";
  return "on_target";
}

/** Weighted target: Σ target × available ÷ Σ available (§6.2). */
export function weightedTarget(people: { target: number; available: number }[]): number | null {
  const hours = people.reduce((s, p) => s + p.available, 0);
  if (hours <= 0) return null;
  return round2(people.reduce((s, p) => s + p.target * p.available, 0) / hours);
}

export type CapacityStatus = "enough" | "tight" | "short";

/** Remaining capacity status (§6.5): short below 0, tight under 10% of the targeted hours. */
export function capacityStatus(remaining: number, targeted: number): CapacityStatus {
  if (remaining < 0) return "short";
  if (targeted > 0 && remaining < targeted * 0.1) return "tight";
  return "enough";
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
