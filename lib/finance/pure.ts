import { addMonths, monthStart, type IsoDate } from "@/lib/time/pure";
import { AGING_BUCKETS, agingBucket, lastDayOfMonth, round2, type AgingBucket } from "@/lib/clevel/pure";
import { fromMinor, toMinor } from "@/lib/invoices/pure";

/**
 * Finance Overview math: revenue forecast for the rest of this month and the
 * next `horizon` months, from money already asked for (payment requests),
 * recurring retainer fees and the unbilled rest of fixed contracts, plus a
 * trend line from past revenue. Pure and unit-tested; amounts are IDR.
 */

export type ForecastRequest = {
  due: IsoDate;
  /** IDR estimate; null when the currency has no rate. */
  idr: number | null;
  /** On an invoice that is still a draft (not sent yet). */
  draft: boolean;
};

export type ForecastRetainer = {
  endDate: IsoDate | null;
  /** Monthly fee in IDR; null when no fee is set or it has no rate. */
  feeIdr: number | null;
  /** Month starts that already have a (non-void) payment request due — counted as requests instead. */
  billedMonths: IsoDate[];
};

export type ForecastContract = {
  endDate: IsoDate | null;
  /** Contract value not yet invoiced, in IDR; null without a value or a rate. */
  remainingIdr: number | null;
};

export type ForecastMonth = {
  month: IsoDate;
  /** The current month: only what is still expected after today. */
  current: boolean;
  invoiced: number;
  overdue: number;
  retainer: number;
  contract: number;
  draft: number;
  total: number;
};

/** Months the forecast covers: this month, then `horizon` more. */
export function forecastWindow(today: IsoDate, horizon: number): IsoDate[] {
  const first = monthStart(today);
  return Array.from({ length: horizon + 1 }, (_, i) => addMonths(first, i));
}

/**
 * Spreads `amount` evenly over the months from `from` to the month of `end`
 * (inclusive), in minor units so the parts add back to the whole.
 */
export function spreadRemaining(amount: number, from: IsoDate, end: IsoDate): Map<IsoDate, number> {
  const out = new Map<IsoDate, number>();
  const last = monthStart(end);
  const months: IsoDate[] = [];
  for (let m = monthStart(from); m <= last; m = addMonths(m, 1)) months.push(m);
  if (months.length === 0 || amount <= 0) return out;
  const minor = toMinor(amount, "IDR");
  const each = Math.floor(minor / months.length);
  months.forEach((m, i) => out.set(m, fromMinor(i === months.length - 1 ? minor - each * (months.length - 1) : each, "IDR")));
  return out;
}

export function forecastMonths(input: {
  today: IsoDate;
  horizon: number;
  requests: ForecastRequest[];
  retainers: ForecastRetainer[];
  contracts: ForecastContract[];
}): {
  months: ForecastMonth[];
  /** Fixed contracts with unbilled value but no end date to spread it to. */
  unscheduled: { count: number; idr: number };
  /** Retainers left out for lack of a fee (or a rate). */
  retainerMissingFee: number;
  /** Requests left out for lack of a rate. */
  missingRate: number;
} {
  const { today } = input;
  const window = forecastWindow(today, input.horizon);
  const thisMonth = window[0]!;
  const lastDay = lastDayOfMonth(window[window.length - 1]!);
  const rows = new Map(window.map((m) => [m, { invoiced: 0, overdue: 0, retainer: 0, contract: 0, draft: 0 }]));
  let missingRate = 0;

  for (const r of input.requests) {
    if (r.due > lastDay) continue;
    if (r.idr === null) {
      missingRate += 1;
      continue;
    }
    const late = r.due < today;
    // Anything already past due is still expected — this month.
    const row = rows.get(late ? thisMonth : monthStart(r.due))!;
    if (r.draft) row.draft += r.idr;
    else if (late) row.overdue += r.idr;
    else row.invoiced += r.idr;
  }

  let retainerMissingFee = 0;
  for (const p of input.retainers) {
    if (p.feeIdr === null) {
      retainerMissingFee += 1;
      continue;
    }
    for (const m of window) {
      if (p.endDate && p.endDate < m) continue;
      if (p.billedMonths.includes(m)) continue;
      rows.get(m)!.retainer += p.feeIdr;
    }
  }

  const unscheduled = { count: 0, idr: 0 };
  for (const c of input.contracts) {
    if (c.remainingIdr === null || c.remainingIdr <= 0) continue;
    if (!c.endDate || c.endDate < thisMonth) {
      unscheduled.count += 1;
      unscheduled.idr += c.remainingIdr;
      continue;
    }
    for (const [m, v] of spreadRemaining(c.remainingIdr, thisMonth, c.endDate)) {
      const row = rows.get(m);
      if (row) row.contract += v;
    }
  }

  return {
    months: window.map((m) => {
      const r = rows.get(m)!;
      const parts = { invoiced: round2(r.invoiced), overdue: round2(r.overdue), retainer: round2(r.retainer), contract: round2(r.contract), draft: round2(r.draft) };
      return { month: m, current: m === thisMonth, ...parts, total: round2(parts.invoiced + parts.overdue + parts.retainer + parts.contract + parts.draft) };
    }),
    unscheduled: { count: unscheduled.count, idr: round2(unscheduled.idr) },
    retainerMissingFee,
    missingRate,
  };
}

/**
 * Least-squares line through `values` (one per month, oldest first), carried
 * `ahead` months on; never below zero. Null with fewer than three months of
 * history (counted from the first month with revenue).
 */
export function linearTrend(values: number[], ahead: number): number[] | null {
  const first = values.findIndex((v) => v > 0);
  const ys = first < 0 ? [] : values.slice(first);
  const n = ys.length;
  if (n < 3) return null;
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  ys.forEach((y, x) => {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  });
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  return Array.from({ length: ahead }, (_, i) => round2(Math.max(0, intercept + slope * (n + i))));
}

/** Pending, sent requests by how late they are. */
export function agingSummary(requests: { due: IsoDate; idr: number | null }[], today: IsoDate): { bucket: AgingBucket; count: number; idr: number }[] {
  return AGING_BUCKETS.map((bucket) => {
    const rows = requests.filter((r) => agingBucket(r.due, today) === bucket);
    return { bucket, count: rows.length, idr: round2(rows.reduce((s, r) => s + (r.idr ?? 0), 0)) };
  });
}
