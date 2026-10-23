import { describe, expect, it } from "vitest";
import { avgDealDays, isStale, monthlyCandles, newLeads, openValueAt, pipelineBridge, pipelineTotals, winRate, type DealFacts, type StageMove } from "./pure";

const deal = (over: Partial<DealFacts>): DealFacts => ({
  category: "open",
  valueIdr: 100,
  probability: 50,
  createdOn: "2026-09-01",
  closedOn: null,
  stageSince: "2026-09-01",
  ...over,
});

describe("pipeline cards", () => {
  it("sums open and weighted value, counting deals without a rate apart", () => {
    const t = pipelineTotals([deal({}), deal({ valueIdr: 200, probability: 25 }), deal({ valueIdr: null }), deal({ category: "won", valueIdr: 999 })]);
    expect(t).toEqual({ openIdr: 300, weightedIdr: 100, openCount: 3, unconverted: 1 });
  });

  it("computes win rate and duration from deals closed in the window", () => {
    const deals = [
      deal({ category: "won", createdOn: "2026-09-01", closedOn: "2026-10-01" }),
      deal({ category: "won", createdOn: "2026-10-01", closedOn: "2026-10-11" }),
      deal({ category: "lost", closedOn: "2026-10-05" }),
      deal({ category: "lost", closedOn: "2026-08-05" }),
    ];
    expect(winRate(deals, "2026-10-01", "2026-10-31")).toEqual({ won: 2, lost: 1, rate: 66.7 });
    expect(winRate([], "2026-10-01", "2026-10-31").rate).toBeNull();
    expect(avgDealDays(deals, "2026-10-01", "2026-10-31")).toBe(20);
    expect(newLeads(deals, "2026-10-01", "2026-10-31")).toBe(1);
  });

  it("marks open deals stuck in a stage past the threshold", () => {
    expect(isStale("open", "2026-10-01", "2026-10-22", 14)).toBe(true);
    expect(isStale("open", "2026-10-08", "2026-10-22", 14)).toBe(false);
    expect(isStale("won", "2026-01-01", "2026-10-22", 14)).toBe(false);
  });
});

describe("monthly report", () => {
  it("builds one candle per month from daily snapshots", () => {
    const c = monthlyCandles([
      { date: "2026-10-02", openIdr: 120 },
      { date: "2026-10-01", openIdr: 100 },
      { date: "2026-10-03", openIdr: 80 },
      { date: "2026-10-04", openIdr: 90 },
      { date: "2026-11-01", openIdr: 95 },
    ]);
    expect(c).toEqual([
      { month: "2026-10-01", open: 100, high: 120, low: 80, close: 90, days: 4 },
      { month: "2026-11-01", open: 95, high: 95, low: 95, close: 95, days: 1 },
    ]);
  });

  const moves: StageMove[] = [
    { dealId: "a", on: "2026-09-10", to: "open", valueIdr: 100 },
    { dealId: "b", on: "2026-09-20", to: "open", valueIdr: 50 },
    { dealId: "c", on: "2026-10-03", to: "open", valueIdr: 30 }, // new
    { dealId: "a", on: "2026-10-05", to: "open", valueIdr: 120 }, // next stage, value raised
    { dealId: "a", on: "2026-10-20", to: "won", valueIdr: 120 },
    { dealId: "b", on: "2026-10-21", to: "lost", valueIdr: 50 },
    { dealId: "d", on: "2026-10-22", to: "won", valueIdr: 70 }, // created straight into Won
  ];

  it("knows the open value at the start of a day", () => {
    expect(openValueAt(moves, "2026-10-01")).toBe(150);
    expect(openValueAt(moves, "2026-11-01")).toBe(30);
  });

  it("bridges start to end through new, won, lost and value changes", () => {
    const b = pipelineBridge(moves, "2026-10-01");
    expect(b).toEqual({ month: "2026-10-01", start: 150, added: 30, won: 120, lost: 50, adjusted: 20, end: 30 });
    expect(b.start + b.added - b.won - b.lost + b.adjusted).toBe(b.end);
  });

  it("takes today's values as the end of the running month", () => {
    const b = pipelineBridge(moves, "2026-10-01", 45);
    expect(b.end).toBe(45);
    expect(b.adjusted).toBe(35);
  });
});
