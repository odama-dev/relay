import { describe, expect, it } from "vitest";
import { burnVsProgress, capacityHours, countsForUtilization, isBillableEntry, metricWeek, utilizationPct, workloadFromOverdue, workloadPct } from "./pure";

const mf = [1, 2, 3, 4, 5];
const week = { start: "2026-10-19", end: "2026-10-25" };
const forty = [{ effectiveFrom: "2026-01-01", weeklyHours: 40 }];

describe("metricWeek", () => {
  it("runs Monday to Sunday, so weekend due dates stay in the week", () => {
    expect(metricWeek("2026-10-22")).toEqual(week);
    expect(metricWeek("2026-10-25")).toEqual(week);
    expect(metricWeek("2026-10-26").start).toBe("2026-10-26");
  });
});

describe("isBillableEntry", () => {
  it("counts client-task time unless out-of-scope is still waiting", () => {
    expect(isBillableEntry({ isBillable: true, oosStatus: "none" })).toBe(true);
    expect(isBillableEntry({ isBillable: true, oosStatus: "approved" })).toBe(true);
    expect(isBillableEntry({ isBillable: true, oosStatus: "pending" })).toBe(false);
    expect(isBillableEntry({ isBillable: false, oosStatus: "none" })).toBe(false);
  });
});

describe("capacityHours", () => {
  it("is weekly hours less leave days and holidays", () => {
    expect(capacityHours(forty, [], week, mf)).toBe(40);
    // Leave Thu 15 – Tue 20: Mon and Tue of this week off.
    expect(capacityHours(forty, [{ start: "2026-10-15", end: "2026-10-20", availableHours: 0 }], week, mf)).toBe(24);
    expect(capacityHours(forty, [], week, mf, new Set(["2026-10-21"]))).toBe(32);
    // Leave over a weekend only touches nothing.
    expect(capacityHours(forty, [{ start: "2026-10-24", end: "2026-10-30", availableHours: 0 }], week, mf)).toBe(40);
  });

  it("counts a half day as the override's hours", () => {
    expect(capacityHours(forty, [{ start: "2026-10-20", end: "2026-10-20", availableHours: 4 }], week, mf)).toBe(36);
  });

  it("is zero without contract hours or workdays", () => {
    expect(capacityHours([], [], week, mf)).toBe(0);
    expect(capacityHours(forty, [], { start: "2026-10-24", end: "2026-10-25" }, mf)).toBe(0);
  });
});

describe("utilization", () => {
  it("only counts billable divisions", () => {
    expect(countsForUtilization({ division: "design", role: "designer_dev" })).toBe(true);
    expect(countsForUtilization({ division: "sales", role: "pm" })).toBe(false);
    expect(countsForUtilization({ division: null, role: "pm" })).toBe(true);
    expect(countsForUtilization({ division: null, role: "hr" })).toBe(false);
  });

  it("is billable hours over capacity", () => {
    expect(utilizationPct(30, 40)).toBe(75);
    expect(utilizationPct(10, 0)).toBeNull();
    expect(utilizationPct(10, null)).toBeNull();
  });
});

describe("workload", () => {
  it("is planned hours over capacity and flags piled-up overdue work", () => {
    expect(workloadPct(30, 40)).toBe(75);
    expect(workloadPct(10, 0)).toBeNull();
    expect(workloadFromOverdue(20, 30)).toBe(true);
    expect(workloadFromOverdue(5, 30)).toBe(false);
    expect(workloadFromOverdue(0, 0)).toBe(false);
  });
});

describe("burnVsProgress", () => {
  it("compares hours burnt with tasks done", () => {
    expect(burnVsProgress({ usedHours: 60, budgetHours: 100, doneTasks: 4, totalTasks: 10 })).toEqual({ burnPct: 60, progressPct: 40, ahead: true });
    expect(burnVsProgress({ usedHours: 10, budgetHours: null, doneTasks: 1, totalTasks: 2 })).toEqual({ burnPct: null, progressPct: 50, ahead: null });
  });
});
