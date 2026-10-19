import { describe, expect, it } from "vitest";
import {
  agingBucket,
  attentionReasons,
  availableHours,
  capacityStatus,
  concentration,
  DEFAULT_ATTENTION_RULES,
  delta,
  estimateIdr,
  margin,
  monthTarget,
  personCost,
  previousWindow,
  resolvePeriod,
  targetStatus,
  utilizationStatus,
  weightedTarget,
  windowTarget,
} from "./pure";

const today = "2026-10-16";
const MON_FRI = [1, 2, 3, 4, 5];

describe("periods", () => {
  it("cuts a running period at today and compares the same length before it", () => {
    const p = resolvePeriod("month", today);
    expect(p).toMatchObject({ start: "2026-10-01", end: today, fullEnd: "2026-10-31" });
    expect(previousWindow(p)).toEqual({ start: "2026-09-01", end: "2026-09-16" });
  });
  it("resolves last month, quarter, YTD and custom", () => {
    expect(resolvePeriod("last_month", today)).toMatchObject({ start: "2026-09-01", end: "2026-09-30" });
    expect(previousWindow(resolvePeriod("last_month", today))).toEqual({ start: "2026-08-01", end: "2026-08-30" });
    expect(resolvePeriod("quarter", today)).toMatchObject({ start: "2026-10-01", fullEnd: "2026-12-31" });
    expect(previousWindow(resolvePeriod("quarter", today))).toEqual({ start: "2026-07-01", end: "2026-07-16" });
    expect(previousWindow(resolvePeriod("ytd", today))).toEqual({ start: "2025-01-01", end: "2025-10-16" });
    const c = resolvePeriod("custom", today, { from: "2026-08-11", to: "2026-08-20" });
    expect(previousWindow(c)).toEqual({ start: "2026-08-01", end: "2026-08-10" });
    expect(resolvePeriod("custom", today, { from: "2026-09-01" }).kind).toBe("month");
  });
});

describe("personCost", () => {
  const costs = [
    { effectiveFrom: "2026-01-01", monthlyCostIdr: 10_000_000 },
    { effectiveFrom: "2026-10-01", monthlyCostIdr: 12_400_000 },
  ];
  it("uses the row in force each month, pro-rata by days", () => {
    expect(personCost(costs, { activeFrom: "2025-01-01", activeTo: null }, { start: "2026-09-01", end: "2026-09-30" })).toBe(10_000_000);
    // 16 of 31 days of October at the new cost.
    expect(personCost(costs, { activeFrom: "2025-01-01", activeTo: null }, { start: "2026-10-01", end: "2026-10-16" })).toBe(6_400_000);
  });
  it("counts only the days the person was active; null without a cost", () => {
    expect(personCost(costs, { activeFrom: "2026-09-16", activeTo: null }, { start: "2026-09-01", end: "2026-09-30" })).toBe(5_000_000);
    expect(personCost([], { activeFrom: "2025-01-01", activeTo: null }, { start: "2026-09-01", end: "2026-09-30" })).toBeNull();
  });
});

describe("availableHours", () => {
  const cap = [{ effectiveFrom: "2026-01-01", weeklyHours: 40 }];
  const emp = { activeFrom: "2025-01-01", activeTo: null };
  it("spreads weekly hours over workdays", () => {
    // 1–16 Oct 2026: 12 workdays × 8h.
    expect(availableHours(cap, [], emp, { start: "2026-10-01", end: today }, MON_FRI)).toBe(96);
  });
  it("replaces override days with the override's hours", () => {
    // Leave 12–16 Oct (5 workdays) with 0 hours → 7 workdays × 8h.
    const leave = [{ start: "2026-10-12", end: "2026-10-16", availableHours: 0 }];
    expect(availableHours(cap, leave, emp, { start: "2026-10-01", end: today }, MON_FRI)).toBe(56);
    // Half-time week: 20h over its 5 workdays.
    const half = [{ start: "2026-10-12", end: "2026-10-16", availableHours: 20 }];
    expect(availableHours(cap, half, emp, { start: "2026-10-01", end: today }, MON_FRI)).toBe(76);
  });
  it("is null without any capacity", () => {
    expect(availableHours([], [], emp, { start: "2026-10-01", end: today }, MON_FRI)).toBeNull();
  });
});

describe("revenue targets", () => {
  const rows = [
    { year: 2026, month: null, targetIdr: 1_200_000_000 },
    { year: 2026, month: 10, targetIdr: 155_000_000 },
  ];
  it("falls back to the yearly target ÷ 12", () => {
    expect(monthTarget(rows, "2026-10-01")).toBe(155_000_000);
    expect(monthTarget(rows, "2026-09-01")).toBe(100_000_000);
    expect(monthTarget(rows, "2025-09-01")).toBeNull();
  });
  it("pro-rates partial months and sums full ones", () => {
    expect(windowTarget(rows, { start: "2026-10-01", end: "2026-10-16" })).toBe(80_000_000);
    expect(windowTarget(rows, { start: "2026-08-01", end: "2026-09-30" })).toBe(200_000_000);
  });
  it("rates progress: good ≥ 100, watch 80–99, bad below", () => {
    expect(targetStatus(100, 100)).toEqual({ pct: 100, status: "good" });
    expect(targetStatus(80, 100)?.status).toBe("watch");
    expect(targetStatus(79.9, 100)?.status).toBe("bad");
    expect(targetStatus(5, null)).toBeNull();
  });
  it("compares with the previous window", () => {
    expect(delta(120, 100)).toEqual({ change: 20, pct: 20 });
    expect(delta(10, 0)).toEqual({ change: 10, pct: null });
  });
});

describe("receivables", () => {
  it("buckets by days past due", () => {
    expect(agingBucket(today, today)).toBe("not_due");
    expect(agingBucket("2026-10-15", today)).toBe("late_1_30");
    expect(agingBucket("2026-09-16", today)).toBe("late_1_30");
    expect(agingBucket("2026-09-15", today)).toBe("late_31_60");
    expect(agingBucket("2026-08-16", today)).toBe("late_60_plus");
  });
  it("estimates IDR only with a rate", () => {
    const rates = new Map([["USD", 16_250]]);
    expect(estimateIdr(100, "USD", rates)).toBe(1_625_000);
    expect(estimateIdr(5, "IDR", rates)).toBe(5);
    expect(estimateIdr(5, "EUR", rates)).toBeNull();
  });
});

describe("margin & concentration", () => {
  it("computes margin and its share of revenue", () => {
    expect(margin(100, 70)).toEqual({ value: 30, pct: 30 });
    expect(margin(0, 50)).toEqual({ value: -50, pct: null });
  });
  it("measures top-1 and top-3 client share", () => {
    expect(concentration([50, 20, 20, 10])).toEqual({ top1: 50, top3: 90 });
    expect(concentration([])).toEqual({ top1: null, top3: null });
  });
});

describe("attention reasons", () => {
  it("lists every rule a project breaks", () => {
    expect(attentionReasons({ budgetPct: 112, overdueTasks: 5, maxDaysLate: 21, marginPct: 12 }, DEFAULT_ATTENTION_RULES)).toEqual([
      "Over budget 112%",
      "5 overdue tasks",
      "Payment 21 days late",
      "Margin 12%",
    ]);
    expect(attentionReasons({ budgetPct: 100, overdueTasks: 3, maxDaysLate: 14, marginPct: null }, DEFAULT_ATTENTION_RULES)).toEqual([]);
  });
  it("skips disabled rules", () => {
    const rules = { ...DEFAULT_ATTENTION_RULES, overdueTasks: { enabled: false, value: 3 } };
    expect(attentionReasons({ budgetPct: null, overdueTasks: 9, maxDaysLate: 0, marginPct: null }, rules)).toEqual([]);
  });
});

describe("utilization", () => {
  it("rates against the target ± 15 points", () => {
    expect(utilizationStatus({ utilization: 96, target: 80, logged: 100, available: 120 })).toBe("overload");
    expect(utilizationStatus({ utilization: 70, target: 80, logged: 100, available: 120 })).toBe("on_target");
    expect(utilizationStatus({ utilization: 64, target: 80, logged: 100, available: 120 })).toBe("under");
    expect(utilizationStatus({ utilization: 50, target: 80, logged: 130, available: 120 })).toBe("overload");
  });
  it("weights targets by available hours", () => {
    expect(weightedTarget([{ target: 80, available: 120 }, { target: 20, available: 40 }])).toBe(65);
  });
  it("rates remaining capacity", () => {
    expect(capacityStatus(-1, 100)).toBe("short");
    expect(capacityStatus(5, 100)).toBe("tight");
    expect(capacityStatus(30, 100)).toBe("enough");
  });
});
