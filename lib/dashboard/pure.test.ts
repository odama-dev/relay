import { describe, expect, it } from "vitest";
import { clientPaymentState, daysLate, greeting, onTimeRate, projectStanding, requestDueState, resolveWorkPeriod, sumByCurrency, taskRisk, utilizationPct } from "./pure";

const today = "2026-10-16";

describe("sumByCurrency", () => {
  it("keeps currencies apart, IDR first, without float drift", () => {
    expect(
      sumByCurrency([
        { currency: "USD", amount: 0.1 },
        { currency: "IDR", amount: 45_000_000 },
        { currency: "USD", amount: 0.2 },
        { currency: "EUR", amount: 10 },
      ]),
    ).toEqual([
      { currency: "IDR", amount: 45_000_000 },
      { currency: "EUR", amount: 10 },
      { currency: "USD", amount: 0.3 },
    ]);
  });
});

describe("requestDueState", () => {
  it("is late before today, due soon up to 7 days ahead, nothing after", () => {
    expect(requestDueState("2026-10-15", today)).toBe("late");
    expect(requestDueState(today, today)).toBe("due_soon");
    expect(requestDueState("2026-10-23", today)).toBe("due_soon");
    expect(requestDueState("2026-10-24", today)).toBeNull();
  });
  it("counts days late", () => {
    expect(daysLate("2026-10-06", today)).toBe(10);
    expect(daysLate("2026-10-20", today)).toBe(0);
  });
});

describe("clientPaymentState", () => {
  it("takes the worst open request, and a status set by hand wins", () => {
    expect(clientPaymentState([])).toBe("none");
    expect(clientPaymentState([null, null])).toBe("on_track");
    expect(clientPaymentState([null, "due_soon"])).toBe("due_soon");
    expect(clientPaymentState(["due_soon", "late", null])).toBe("late");
    expect(clientPaymentState(["late"], "on_track")).toBe("on_track");
    expect(clientPaymentState([], "late")).toBe("late");
  });
});

describe("taskRisk", () => {
  const base = { dueDate: null, status: "todo", ownerId: "u" };
  it("names the first reason: overdue, blocked, no owner", () => {
    expect(taskRisk({ ...base, dueDate: "2026-10-15", status: "blocked", ownerId: null }, today)).toBe("overdue");
    expect(taskRisk({ ...base, status: "blocked", ownerId: null }, today)).toBe("blocked");
    expect(taskRisk({ ...base, ownerId: null }, today)).toBe("no_owner");
    expect(taskRisk(base, today)).toBeNull();
  });
  it("never flags a done task, and due today isn't overdue", () => {
    expect(taskRisk({ ...base, dueDate: "2026-10-01", status: "done", ownerId: null }, today)).toBeNull();
    expect(taskRisk({ ...base, dueDate: today }, today)).toBeNull();
  });
});

describe("onTimeRate", () => {
  it("scores only completed tasks with a due date", () => {
    expect(
      onTimeRate([
        { dueDate: "2026-10-10", completedOn: "2026-10-10" },
        { dueDate: "2026-10-10", completedOn: "2026-10-12" },
        { dueDate: "2026-10-20", completedOn: "2026-10-01" },
        { dueDate: null, completedOn: "2026-10-01" },
        { dueDate: "2026-10-30", completedOn: null },
      ]),
    ).toBe(67);
    expect(onTimeRate([{ dueDate: null, completedOn: "2026-10-01" }])).toBeNull();
  });
});

describe("greeting", () => {
  it("greets by the hour", () => {
    expect(greeting("08:30")).toBe("Good morning");
    expect(greeting("13:00")).toBe("Good afternoon");
    expect(greeting("17:59")).toBe("Good evening");
    expect(greeting("22:00")).toBe("Good night");
  });
});

describe("resolveWorkPeriod", () => {
  it("compares this week so far with the same days last week, one bar per day", () => {
    const p = resolveWorkPeriod("week", "2026-10-21"); // Wednesday
    expect([p.start, p.end]).toEqual(["2026-10-19", "2026-10-21"]);
    expect(p.prev).toEqual({ start: "2026-10-12", end: "2026-10-14" });
    expect(p.buckets.map((b) => b.label)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
  it("splits a month into weeks clipped to the month", () => {
    const p = resolveWorkPeriod("month", "2026-10-20");
    expect(p.prev).toEqual({ start: "2026-09-01", end: "2026-09-20" });
    expect(p.buckets[0]).toEqual({ start: "2026-10-01", end: "2026-10-04", label: "1 Oct" });
    expect(p.buckets.at(-1)).toEqual({ start: "2026-10-26", end: "2026-10-31", label: "26 Oct" });
  });
  it("covers whole months for longer periods", () => {
    const p = resolveWorkPeriod("3m", "2026-10-20");
    expect(p.start).toBe("2026-08-01");
    expect(p.prev.start).toBe("2026-05-01");
    expect(p.buckets.map((b) => b.label)).toEqual(["Aug", "Sept", "Oct"]);
  });
});

describe("projectStanding", () => {
  const base = { status: "active" as const, endDate: null, health: "on_track" as const, overdueTasks: 0, blockedTasks: 0, openTasks: 3 };
  it("is on track without a reason", () => {
    expect(projectStanding(base, today)).toEqual({ standing: "on_track", reasons: [] });
  });
  it("is delayed past the end date or with overdue tasks, delay reasons first", () => {
    expect(projectStanding({ ...base, endDate: "2026-10-10", health: "over_budget" }, today)).toEqual({ standing: "delayed", reasons: ["Past end date by 6d", "Over budget"] });
    expect(projectStanding({ ...base, overdueTasks: 1 }, today).standing).toBe("delayed");
  });
  it("is at risk on a budget warning, a blocked task, on hold, or ending soon with open work", () => {
    expect(projectStanding({ ...base, health: "warning" }, today).reasons).toEqual(["Budget warning"]);
    expect(projectStanding({ ...base, blockedTasks: 2 }, today).standing).toBe("at_risk");
    expect(projectStanding({ ...base, status: "on_hold" }, today).standing).toBe("at_risk");
    expect(projectStanding({ ...base, endDate: "2026-10-20" }, today).reasons).toEqual(["Ends soon with 3 open"]);
    expect(projectStanding({ ...base, endDate: "2026-10-20", openTasks: 0 }, today).standing).toBe("on_track");
    expect(projectStanding({ ...base, endDate: "2026-10-30" }, today).standing).toBe("on_track");
  });
});

describe("utilizationPct", () => {
  it("is billable hours over capacity, null without capacity", () => {
    expect(utilizationPct(30 * 60, 40)).toBe(75);
    expect(utilizationPct(60, 0)).toBeNull();
  });
});
