import { describe, expect, it } from "vitest";
import { agingSummary, forecastMonths, forecastWindow, linearTrend, spreadRemaining } from "./pure";

const today = "2026-10-19";
const base = { today, horizon: 3, requests: [], retainers: [], contracts: [] };

describe("forecast window", () => {
  it("is this month plus the horizon", () => {
    expect(forecastWindow(today, 3)).toEqual(["2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01"]);
  });
});

describe("revenue forecast", () => {
  it("puts sent requests in their due month and past-due ones in this month as overdue", () => {
    const { months } = forecastMonths({
      ...base,
      requests: [
        { due: "2026-11-05", idr: 1_000_000, draft: false },
        { due: "2026-09-30", idr: 400_000, draft: false },
        { due: "2026-10-25", idr: 250_000, draft: false },
      ],
    });
    expect(months[0]).toMatchObject({ month: "2026-10-01", current: true, invoiced: 250_000, overdue: 400_000, total: 650_000 });
    expect(months[1]).toMatchObject({ invoiced: 1_000_000, overdue: 0 });
  });

  it("keeps drafts apart, and leaves out requests beyond the horizon or without a rate", () => {
    const f = forecastMonths({
      ...base,
      requests: [
        { due: "2026-12-10", idr: 300_000, draft: true },
        { due: "2027-03-01", idr: 9_000_000, draft: false },
        { due: "2026-11-01", idr: null, draft: false },
      ],
    });
    expect(f.months[2]).toMatchObject({ draft: 300_000, invoiced: 0, total: 300_000 });
    expect(f.months.reduce((s, m) => s + m.total, 0)).toBe(300_000);
    expect(f.missingRate).toBe(1);
  });

  it("adds a retainer fee to every month it runs, except months already billed", () => {
    const f = forecastMonths({
      ...base,
      retainers: [
        { endDate: "2026-12-31", feeIdr: 5_000_000, billedMonths: ["2026-10-01"] },
        { endDate: null, feeIdr: null, billedMonths: [] },
      ],
    });
    expect(f.months.map((m) => m.retainer)).toEqual([0, 5_000_000, 5_000_000, 0]);
    expect(f.retainerMissingFee).toBe(1);
  });

  it("spreads a fixed contract's unbilled rest to its end date; without an end date it is unscheduled", () => {
    const f = forecastMonths({
      ...base,
      contracts: [
        { endDate: "2026-11-20", remainingIdr: 10_000_000 },
        { endDate: null, remainingIdr: 2_000_000 },
        { endDate: "2027-06-30", remainingIdr: 0 },
      ],
    });
    expect(f.months.map((m) => m.contract)).toEqual([5_000_000, 5_000_000, 0, 0]);
    expect(f.unscheduled).toEqual({ count: 1, idr: 2_000_000 });
  });
});

describe("spreading a remainder", () => {
  it("splits evenly in whole rupiah and the parts add back up", () => {
    const parts = spreadRemaining(100, "2026-10-01", "2026-12-15");
    expect([...parts.values()]).toEqual([33, 33, 34]);
  });

  it("is empty when the end is before the start", () => {
    expect(spreadRemaining(100, "2026-10-01", "2026-09-30").size).toBe(0);
  });
});

describe("trend line", () => {
  it("continues a straight line", () => {
    expect(linearTrend([10, 20, 30, 40], 2)).toEqual([50, 60]);
  });

  it("ignores the empty months before revenue started", () => {
    expect(linearTrend([0, 0, 0, 100, 100, 100], 1)).toEqual([100]);
  });

  it("never goes below zero", () => {
    expect(linearTrend([300, 200, 100], 3)).toEqual([0, 0, 0]);
  });

  it("needs three months of history", () => {
    expect(linearTrend([0, 0, 50, 60], 3)).toBeNull();
  });
});

describe("aging", () => {
  it("buckets requests by days late", () => {
    const a = agingSummary(
      [
        { due: "2026-10-30", idr: 1 },
        { due: "2026-10-01", idr: 2 },
        { due: "2026-07-01", idr: 3 },
      ],
      today,
    );
    expect(a.map((x) => [x.bucket, x.count, x.idr])).toEqual([
      ["not_due", 1, 1],
      ["late_1_30", 1, 2],
      ["late_31_60", 0, 0],
      ["late_60_plus", 1, 3],
    ]);
  });
});
