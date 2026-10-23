import type { ObligationKind, ObligationRecurrence } from "@prisma/client";
import { AGING_BUCKETS, agingBucket, lastDayOfMonth, round2, type AgingBucket } from "@/lib/clevel/pure";
import { addMonths, monthStart, type IsoDate } from "@/lib/time/pure";

/**
 * Finance operations (PRD Phase 2 "Finance", M10): when obligations fall
 * due, and what each client owes by age. Pure — the queries load rows.
 */

export type ObligationRule = {
  recurrence: ObligationRecurrence;
  dayOfMonth: number;
  month: number | null;
  onDate: IsoDate | null;
};

export const OBLIGATION_KIND_LABELS: Record<ObligationKind, string> = { payroll: "Payroll", bpjs: "BPJS", tax: "Tax", other: "Other" };

/** `day` in `month`, or the month's last day when it's shorter (the 31st in April → 30 April). */
function dayIn(month: IsoDate, day: number): IsoDate {
  const last = lastDayOfMonth(month);
  return Number(last.slice(8)) < day ? last : `${month.slice(0, 8)}${String(day).padStart(2, "0")}`;
}

/** Due dates of an obligation between `from` and `to` (inclusive). */
export function obligationDates(o: ObligationRule, from: IsoDate, to: IsoDate): IsoDate[] {
  if (o.recurrence === "once") return o.onDate && o.onDate >= from && o.onDate <= to ? [o.onDate] : [];
  const out: IsoDate[] = [];
  for (let m = monthStart(from); m <= to; m = addMonths(m, 1)) {
    if (o.recurrence === "yearly" && Number(m.slice(5, 7)) !== o.month) continue;
    const d = dayIn(m, o.dayOfMonth);
    if (d >= from && d <= to) out.push(d);
  }
  return out;
}

export type ClientAging = {
  clientId: string;
  client: string;
  buckets: Record<AgingBucket, number>;
  total: number;
  /** Requests without an IDR rate, left out of the sums. */
  unconverted: number;
};

/**
 * Receivables per client, by how late each unpaid request is — the same
 * buckets as the studio's aging (not due, 1–30, 31–60, over 60 days late),
 * in IDR. Largest late amount first.
 */
export function agingByClient(requests: { clientId: string; client: string; due: IsoDate; idr: number | null }[], today: IsoDate): ClientAging[] {
  const byClient = new Map<string, ClientAging>();
  for (const r of requests) {
    const row =
      byClient.get(r.clientId) ??
      ({ clientId: r.clientId, client: r.client, buckets: Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<AgingBucket, number>, total: 0, unconverted: 0 } satisfies ClientAging);
    if (r.idr === null) row.unconverted++;
    else {
      const b = agingBucket(r.due, today);
      row.buckets[b] = round2(row.buckets[b] + r.idr);
      row.total = round2(row.total + r.idr);
    }
    byClient.set(r.clientId, row);
  }
  const late = (c: ClientAging) => c.total - c.buckets.not_due;
  return [...byClient.values()].sort((a, b) => late(b) - late(a) || b.total - a.total);
}
