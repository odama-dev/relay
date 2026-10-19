import { describe, expect, it } from "vitest";
import { carryOver, healthStatus, retainerMonths, riskScore, snapshot, type RetainerSettings } from "./pure";

const mins = (inScope: number, pending = 0, approved = 0) => ({ inScope: inScope * 60, pending: pending * 60, approved: approved * 60 });

describe("snapshot (fixed / time & material)", () => {
  it("counts only in-scope hours against the budget", () => {
    const s = snapshot(100, mins(60, 5, 10), [75, 100]);
    expect(s).toMatchObject({
      budgetHours: 100,
      usedHours: 60,
      remainingHours: 40,
      pct: 60,
      pendingOosHours: 5,
      approvedOosHours: 10,
      status: "on_track",
      passedThresholds: [],
    });
  });

  it("warns from the first threshold and goes over budget past 100%", () => {
    expect(snapshot(100, mins(75), [75, 100]).status).toBe("warning");
    expect(snapshot(100, mins(100), [75, 100])).toMatchObject({ status: "warning", passedThresholds: [75, 100] });
    expect(snapshot(100, mins(101), [75, 100]).status).toBe("over_budget");
    expect(snapshot(100, mins(55), [50, 80, 100])).toMatchObject({ status: "warning", passedThresholds: [50] });
  });

  it("reports hours without a percentage when there is no budget", () => {
    expect(snapshot(null, mins(12), [75, 100])).toMatchObject({ budgetHours: null, usedHours: 12, pct: null, status: "no_budget" });
    expect(healthStatus(null, [75])).toBe("no_budget");
  });
});

describe("retainer rollover", () => {
  const none: RetainerSettings = { hoursPerMonth: 40, rolloverMode: "none", capHours: null };
  const full: RetainerSettings = { ...none, rolloverMode: "full" };
  const capped: RetainerSettings = { ...none, rolloverMode: "capped", capHours: 5 };

  it("carries nothing, everything, or up to the cap — never negative", () => {
    expect(carryOver(40, 30, none)).toBe(0);
    expect(carryOver(40, 30, full)).toBe(10);
    expect(carryOver(40, 30, capped)).toBe(5);
    expect(carryOver(40, 50, full)).toBe(0);
  });

  it("builds each month's budget from the previous month's leftover", () => {
    const months = retainerMonths(
      [
        { month: "2026-08-01", settings: full, minutes: mins(30) },
        { month: "2026-09-01", settings: full, minutes: mins(55) },
        { month: "2026-10-01", settings: full, minutes: mins(10) },
      ],
      [75, 100],
    );
    expect(months.map((m) => [m.rolloverInHours, m.budgetHours, m.rolloverOutHours])).toEqual([
      [0, 40, 10],
      [10, 50, 0],
      [0, 40, 30],
    ]);
  });

  it("overspending one month doesn't cut the next", () => {
    const months = retainerMonths(
      [
        { month: "2026-08-01", settings: full, minutes: mins(60) },
        { month: "2026-09-01", settings: full, minutes: mins(0) },
      ],
      [75, 100],
    );
    expect(months[0]!.status).toBe("over_budget");
    expect(months[1]!.budgetHours).toBe(40);
  });

  it("applies a mode change from the month it was made", () => {
    // August ran on "none": its leftover is lost even though September is "full".
    const months = retainerMonths(
      [
        { month: "2026-08-01", settings: none, minutes: mins(20) },
        { month: "2026-09-01", settings: capped, minutes: mins(20) },
        { month: "2026-10-01", settings: capped, minutes: mins(0) },
      ],
      [75, 100],
    );
    expect(months.map((m) => m.budgetHours)).toEqual([40, 40, 45]);
  });

  it("ignores pending and approved out-of-scope hours", () => {
    const [m] = retainerMonths([{ month: "2026-10-01", settings: full, minutes: mins(10, 20, 30) }], [75]);
    expect(m).toMatchObject({ usedHours: 10, pendingOosHours: 20, approvedOosHours: 30, rolloverOutHours: 30 });
  });
});

describe("riskScore", () => {
  it("orders over budget before warning before on track", () => {
    const over = riskScore({ status: "over_budget", pct: 101, overdueTasks: 0, pendingOos: 0 });
    const warn = riskScore({ status: "warning", pct: 99, overdueTasks: 10, pendingOos: 5 });
    const ok = riskScore({ status: "on_track", pct: 10, overdueTasks: 0, pendingOos: 0 });
    expect(over).toBeGreaterThan(warn);
    expect(warn).toBeGreaterThan(ok);
  });
});
