import { describe, expect, it } from "vitest";
import { avgDealDays, clientCodeCandidates, funnel, isStale, leadSourceComparison, monthlyCandles, newLeads, normalizeLeadSource, resolveStageName, wonByMonth, openValueAt, pipelineBridge, pipelineTotals, reportPeriod, winRate, type DealFacts, type StageMove } from "./pure";

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

describe("normalizeLeadSource", () => {
  it("maps free text onto the list", () => {
    expect(normalizeLeadSource("Dribbble")).toBe("dribbble");
    expect(normalizeLeadSource(" Company website ")).toBe("website");
    expect(normalizeLeadSource("Cold email")).toBe("email");
    expect(normalizeLeadSource("Referral")).toBe("referral");
    expect(normalizeLeadSource("Networking event")).toBe("referral");
    expect(normalizeLeadSource("Existing client")).toBe("referral");
    expect(normalizeLeadSource("Upwork")).toBe("other");
    expect(normalizeLeadSource("contra")).toBe("contra");
  });
  it("keeps empty values empty", () => {
    expect(normalizeLeadSource("")).toBeNull();
    expect(normalizeLeadSource(null)).toBeNull();
  });
});

describe("sales report", () => {
  const steps = [
    { label: "Qualified", position: 1 },
    { label: "Discovery call", position: 2 },
    { label: "Closed won", position: "won" as const },
  ];
  it("counts a deal at every step it passed, even a skipped one", () => {
    const f = funnel(
      [
        { furthestOpen: 0, won: false, valueIdr: 10 },
        { furthestOpen: 1, won: false, valueIdr: 20 },
        { furthestOpen: 3, won: false, valueIdr: 30 },
        { furthestOpen: 0, won: true, valueIdr: 40 },
      ],
      steps,
    );
    expect(f.map((s) => s.deals)).toEqual([3, 2, 1]);
    expect(f.map((s) => s.valueIdr)).toEqual([90, 70, 40]);
  });
  it("compares lead sources by win rate of closed deals", () => {
    const rows = leadSourceComparison([
      { source: "referral", category: "won", valueIdr: 100 },
      { source: "referral", category: "lost", valueIdr: 50 },
      { source: "referral", category: "open", valueIdr: 10 },
      { source: null, category: "open", valueIdr: 5 },
    ]);
    expect(rows).toEqual([
      { source: "referral", label: "Referral / networking", leads: 3, won: 1, lost: 1, winRate: 50, wonIdr: 100 },
      { source: "unknown", label: "Not set", leads: 1, won: 0, lost: 0, winRate: null, wonIdr: 0 },
    ]);
  });
  it("sums won value by the month it closed", () => {
    const rows = wonByMonth(
      [
        { category: "won", closedOn: "2026-09-03", valueIdr: 100 },
        { category: "won", closedOn: "2026-09-28", valueIdr: 50 },
        { category: "lost", closedOn: "2026-09-10", valueIdr: 999 },
        { category: "won", closedOn: "2026-10-01", valueIdr: 25 },
      ],
      ["2026-09-01", "2026-10-01"],
    );
    expect(rows).toEqual([
      { month: "2026-09-01", deals: 2, valueIdr: 150 },
      { month: "2026-10-01", deals: 1, valueIdr: 25 },
    ]);
  });
});

describe("resolveStageName", () => {
  const stages = new Map([
    ["researched", "r"],
    ["contacted", "c"],
    ["call booked", "cb"],
    ["proposal", "p"],
  ]);
  it("takes current names, and maps the old pipeline's", () => {
    expect(resolveStageName("Proposal", stages)).toBe("p");
    expect(resolveStageName(" Proposal sent ", stages)).toBe("p");
    expect(resolveStageName("Lead", stages)).toBe("r");
    expect(resolveStageName("Discovery call", stages)).toBe("cb");
    expect(resolveStageName("Pitching", stages)).toBeUndefined();
  });
});

describe("sales report period", () => {
  const today = "2026-10-26";
  it("covers whole months ending this month for a preset, 6M by default", () => {
    expect(reportPeriod({}, today, null)).toEqual({ range: "6m", from: "2026-05-01", to: today });
    expect(reportPeriod({ range: "3m" }, today, null)).toEqual({ range: "3m", from: "2026-08-01", to: today });
    expect(reportPeriod({ range: "1y" }, today, null)).toEqual({ range: "1y", from: "2025-11-01", to: today });
    expect(reportPeriod({ range: "nope" }, today, null).range).toBe("6m");
  });

  it("starts All time at the first lead's month", () => {
    expect(reportPeriod({ range: "all" }, today, "2024-03-18")).toEqual({ range: "all", from: "2024-03-01", to: today });
    expect(reportPeriod({ range: "all" }, today, null).from).toBe("2026-10-01");
  });

  it("lets a custom range win, ending today when the end is missing or before the start", () => {
    expect(reportPeriod({ range: "3m", from: "2026-01-10", to: "2026-02-20" }, today, null)).toEqual({ range: "custom", from: "2026-01-10", to: "2026-02-20" });
    expect(reportPeriod({ from: "2026-01-10", to: "2025-12-01" }, today, null).to).toBe(today);
  });
});

describe("clientCodeCandidates", () => {
  it("starts from the initials, then the first word", () => {
    const c = clientCodeCandidates("Nusantara Bank");
    expect(c[0]).toBe("NB");
    expect(c.slice(1, 3)).toEqual(["NUS", "NU"]);
  });

  it("uses one word's first letters", () => {
    expect(clientCodeCandidates("Arunika Ventures Group")[0]).toBe("AVG");
    expect(clientCodeCandidates("Kopi")[0]).toBe("KOP");
  });

  it("only returns valid codes, never INT, and always has fallbacks", () => {
    const c = clientCodeCandidates("Internal 2026");
    expect(c).not.toContain("INT");
    expect(c.every((x) => /^[A-Z]{2,3}$/.test(x))).toBe(true);
    expect(clientCodeCandidates("123").length).toBeGreaterThan(20);
    expect(new Set(c).size).toBe(c.length);
  });
});
