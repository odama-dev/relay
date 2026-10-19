import { describe, expect, it } from "vitest";
import { daysLate, greeting, onTimeRate, requestDueState, sumByCurrency, taskRisk } from "./pure";

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
