import { describe, expect, it } from "vitest";
import { addWorkdays, agreedDue, effectiveDue, isOnTime, isOverdueTiming, onTimeScore, reviewerDelay, workdaysAfter, type TaskTiming } from "./pure";

const cal = { workdays: [1, 2, 3, 4, 5], holidays: new Set<string>() };
const task = (over: Partial<TaskTiming> = {}): TaskTiming => ({ firstDue: "2026-10-23", changes: [], rounds: [], approvedOn: null, ...over });

describe("working days", () => {
  it("skips weekends and holidays", () => {
    expect(workdaysAfter("2026-10-23", "2026-10-27", cal)).toBe(2); // Fri → Tue: Mon, Tue
    expect(addWorkdays("2026-10-23", 1, cal)).toBe("2026-10-26");
    expect(addWorkdays("2026-10-23", 1, { ...cal, holidays: new Set(["2026-10-26"]) })).toBe("2026-10-27");
    expect(addWorkdays("2026-10-23", 0, cal)).toBe("2026-10-23");
  });
});

describe("reviewerDelay", () => {
  it("sums working days past each round's SLA, open rounds up to today", () => {
    const rounds = [
      { slaDueOn: "2026-10-20", decidedOn: "2026-10-20" }, // within SLA
      { slaDueOn: "2026-10-21", decidedOn: "2026-10-23" }, // 2 days late
      { slaDueOn: "2026-10-26", decidedOn: null }, // still open
    ];
    expect(reviewerDelay(rounds, "2026-10-27", cal)).toBe(3);
  });
});

describe("agreedDue", () => {
  it("moves the due date only for changes approved before it passed", () => {
    expect(agreedDue("2026-10-23", [{ toDate: "2026-10-30", approvedOn: "2026-10-22" }])).toBe("2026-10-30");
    expect(agreedDue("2026-10-23", [{ toDate: "2026-10-30", approvedOn: "2026-10-24" }])).toBe("2026-10-23");
    expect(agreedDue("2026-10-23", [{ toDate: "2026-10-30", approvedOn: null }])).toBe("2026-10-23");
  });
});

describe("on time", () => {
  it("adds the reviewer's delay to the due date", () => {
    const t = task({ rounds: [{ slaDueOn: "2026-10-22", decidedOn: "2026-10-26" }], approvedOn: "2026-10-26" });
    expect(effectiveDue(t, "2026-10-27", cal)).toBe("2026-10-27"); // 2 working days late → Fri + 2
    expect(isOnTime(t, "2026-10-27", cal)).toBe(true);
  });

  it("charges revision time to the owner and skips tasks without a due date", () => {
    expect(isOnTime(task({ approvedOn: "2026-10-26" }), "2026-10-27", cal)).toBe(false);
    expect(isOnTime(task({ firstDue: null, approvedOn: "2026-10-26" }), "2026-10-27", cal)).toBeNull();
    expect(isOnTime(task(), "2026-10-27", cal)).toBeNull();
  });

  it("is overdue once the effective due passes without approval", () => {
    expect(isOverdueTiming(task(), "2026-10-24", cal)).toBe(true);
    expect(isOverdueTiming(task(), "2026-10-23", cal)).toBe(false);
  });
});

describe("onTimeScore", () => {
  it("averages weekly scores and skips weeks off", () => {
    const tasks = [
      task({ firstDue: "2026-10-20", approvedOn: "2026-10-20" }),
      task({ firstDue: "2026-10-21", approvedOn: "2026-10-22" }),
      task({ firstDue: "2026-10-25", approvedOn: "2026-10-24" }), // Sunday due → same week
      task({ firstDue: "2026-10-28", approvedOn: "2026-10-28" }),
      task({ firstDue: "2026-11-30", approvedOn: null }), // not yet due
    ];
    const r = onTimeScore(tasks, { start: "2026-10-01", end: "2026-12-31" }, "2026-11-02", cal);
    expect(r.weeks.map((w) => [w.start, w.due, w.onTime])).toEqual([
      ["2026-10-19", 3, 2],
      ["2026-10-26", 1, 1],
    ]);
    expect(r.score).toBe(83.4); // (66.7 + 100) / 2
    expect(onTimeScore(tasks, { start: "2026-10-01", end: "2026-12-31" }, "2026-11-02", cal, new Set(["2026-10-19"])).score).toBe(100);
  });
});
