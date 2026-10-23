import { describe, expect, it } from "vitest";
import { aggregate, gradeOf, inCalibration, krProgress, normalize, okrWarnings, periodOf, proRataFactor, templateWarnings, weeksIn, weightedScore, type MetricRow } from "./pure";
import { explainMetric, metricDefinitionSchema, type MetricDefinition } from "./definition";

const oct = { start: "2026-10-01", end: "2026-10-31" };
const def = (d: Partial<MetricDefinition> & Pick<MetricDefinition, "source" | "aggregation">): MetricDefinition =>
  metricDefinitionSchema.parse({ filters: {}, ...d });
const row = (date: string, over: Partial<MetricRow> = {}): MetricRow => ({ userId: "u", date, ...over });

describe("aggregate", () => {
  it("counts filtered rows in the window, zero included", () => {
    const d = def({ source: "task", aggregation: "count", filters: { types: ["content"], statuses: ["approved"] } });
    const rows = [row("2026-10-02", { typeKey: "content", status: "approved" }), row("2026-10-03", { typeKey: "bug", status: "approved" }), row("2026-11-01", { typeKey: "content", status: "approved" })];
    expect(aggregate(d, rows, oct)).toBe(1);
    expect(aggregate(d, [], oct)).toBe(0);
  });

  it("scores a share per week and averages the weeks", () => {
    const d = def({ source: "task", aggregation: "percent", part: { onTime: true }, weekly: true });
    const rows = [row("2026-10-05", { onTime: true }), row("2026-10-06", { onTime: false }), row("2026-10-13", { onTime: true })];
    expect(aggregate(d, rows, oct)).toBe(75);
    expect(aggregate(d, [], oct)).toBeNull();
  });

  it("averages per week and per deliverable (distinct weeks = revision rounds)", () => {
    const perWeek = def({ source: "task", aggregation: "average", per: "week" });
    expect(weeksIn(oct)).toHaveLength(4);
    expect(aggregate(perWeek, [row("2026-10-05"), row("2026-10-06"), row("2026-10-20")], oct)).toBe(0.8);
    const rounds = def({ source: "task", aggregation: "average", per: "group", distinctWeeks: true });
    const rows = [row("2026-10-05", { group: "a" }), row("2026-10-07", { group: "a" }), row("2026-10-14", { group: "a" }), row("2026-10-14", { group: "b" })];
    expect(aggregate(rounds, rows, oct)).toBe(1.5);
  });

  it("turns ratings into a percentage of 5 and ratios into percent", () => {
    expect(aggregate(def({ source: "rating", aggregation: "rating" }), [row("2026-10-05", { value: 4 }), row("2026-10-12", { value: 5 })], oct)).toBe(90);
    expect(aggregate(def({ source: "release", aggregation: "ratio" }), [row("2026-10-05", { value: 1, total: 10 }), row("2026-10-12", { value: 0, total: 10 })], oct)).toBe(5);
  });
});

describe("normalize", () => {
  it("follows the PRD table", () => {
    expect(normalize(45, 90, "higher")).toBe(50);
    expect(normalize(120, 90, "higher")).toBe(100);
    expect(normalize(2, 2, "lower")).toBe(100);
    expect(normalize(4, 2, "lower")).toBe(50);
    expect(normalize(5, 2, "record")).toBeNull();
    expect(normalize(null, 2, "higher")).toBeNull();
  });
});

describe("weightedScore and grade", () => {
  it("weights only items with data", () => {
    expect(weightedScore([{ score: 100, weight: 2, scored: true }, { score: 40, weight: 1, scored: true }, { score: null, weight: 5, scored: true }, { score: 0, weight: 1, scored: false }])).toBe(80);
    expect(weightedScore([{ score: null, weight: 1, scored: true }])).toBeNull();
  });

  it("maps scores to grades", () => {
    expect(gradeOf(84)?.grade).toBe("A");
    expect(gradeOf(83.9)?.grade).toBe("B");
    expect(gradeOf(50)?.grade).toBe("C");
    expect(gradeOf(33)?.grade).toBe("E");
    expect(gradeOf(null)).toBeNull();
  });
});

describe("pro-rata, calibration, periods", () => {
  it("scales count targets by hours and time employed", () => {
    expect(proRataFactor({ weeklyHours: 20, activeFrom: null }, oct)).toBe(0.5);
    expect(proRataFactor({ weeklyHours: 40, activeFrom: "2026-10-17" }, oct)).toBe(0.484);
    expect(proRataFactor({ weeklyHours: null, activeFrom: "2026-01-01" }, oct)).toBe(1);
  });

  it("calibrates the first two months", () => {
    expect(inCalibration("2026-10-15", "2026-10-01")).toBe(true);
    expect(inCalibration("2026-10-15", "2026-11-01")).toBe(true);
    expect(inCalibration("2026-10-15", "2026-12-01")).toBe(false);
    expect(inCalibration(null, "2026-12-01")).toBe(false);
  });

  it("finds the month and the half-year", () => {
    expect(periodOf("monthly", "2026-02-10")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(periodOf("semester", "2026-10-10")).toEqual({ start: "2026-07-01", end: "2026-12-31" });
  });
});

describe("warnings and OKR progress", () => {
  it("warns without blocking", () => {
    expect(templateWarnings([{ name: "Collab", weight: 2, isRating: true, target: 80, recordOnly: false }, { name: "On time", weight: 2, isRating: false, target: 90, recordOnly: false, lastActual: 30, hasRecentData: false }])).toEqual([
      "Rating metrics weigh 50% — keep them at 30% or less.",
      "On time has had no data in the last 30 days.",
      "On time: the target (90) is far from last month's actual (30).",
    ]);
    expect(okrWarnings([{ title: "Grow", keyResults: [{ title: "Launch", kind: "milestone", doneDefinition: "" }] }])).toEqual(["Milestone “Launch” has no definition of done."]);
  });

  it("measures key result progress", () => {
    expect(krProgress({ kind: "milestone", start: null, target: null, current: null, done: false, checklist: { done: 1, total: 4 } })).toBe(25);
    expect(krProgress({ kind: "count", start: 0, target: 10, current: 4, done: false })).toBe(40);
    expect(krProgress({ kind: "lower_better", start: 20, target: 10, current: 15, done: false })).toBe(50);
  });
});

describe("explainMetric", () => {
  it("writes the plain sentence", () => {
    expect(explainMetric(def({ source: "task", aggregation: "average", per: "week", filters: { types: ["content"], statuses: ["approved"] } }))).toBe(
      "Number of tasks of type content that are approved per week, on average.",
    );
  });
});
