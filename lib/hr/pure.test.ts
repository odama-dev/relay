import { describe, expect, it } from "vitest";
import { dayStatus, expandEvents, layoutDay, layoutMonth, layoutWeek, minutesOf, nthStart, workdaysIn, workloadPct, type HrEventInput, type HrExceptionInput } from "./pure";

const event = (over: Partial<HrEventInput> = {}): HrEventInput => ({
  id: "e1",
  title: "Monthly report",
  notes: null,
  color: "blue",
  startDate: "2026-10-01",
  endDate: "2026-10-05",
  allDay: true,
  startTime: null,
  endTime: null,
  recurrence: "none",
  repeatUntil: null,
  ...over,
});
const exception = (over: Partial<HrExceptionInput>): HrExceptionInput => ({
  eventId: "e1",
  occurrenceDate: "2026-11-01",
  cancelled: false,
  title: null,
  notes: null,
  color: null,
  startDate: null,
  endDate: null,
  allDay: null,
  startTime: null,
  endTime: null,
  ...over,
});

describe("nthStart", () => {
  it("moves the 31st to a short month's last day", () => {
    const e = { startDate: "2026-01-31", recurrence: "monthly" as const };
    expect([1, 2, 3].map((n) => nthStart(e, n))).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });
});

describe("expandEvents", () => {
  it("repeats monthly with the same length until the end date", () => {
    const occ = expandEvents([event({ recurrence: "monthly", repeatUntil: "2026-12-15" })], [], "2026-10-01", "2027-03-31");
    expect(occ.map((o) => [o.startDate, o.endDate])).toEqual([
      ["2026-10-01", "2026-10-05"],
      ["2026-11-01", "2026-11-05"],
      ["2026-12-01", "2026-12-05"],
    ]);
  });

  it("repeats weekly and keeps only occurrences touching the range", () => {
    const occ = expandEvents([event({ startDate: "2026-10-05", endDate: "2026-10-05", recurrence: "weekly" })], [], "2026-10-10", "2026-10-31");
    expect(occ.map((o) => o.startDate)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
  });

  it("keeps a multi-day occurrence that started before the range", () => {
    expect(expandEvents([event()], [], "2026-10-04", "2026-10-31")).toHaveLength(1);
  });

  it("skips a cancelled occurrence and applies an edited one", () => {
    const occ = expandEvents(
      [event({ recurrence: "monthly" })],
      [exception({ occurrenceDate: "2026-11-01", cancelled: true }), exception({ occurrenceDate: "2026-12-01", title: "Year-end report", startDate: "2026-12-02", endDate: "2026-12-09" })],
      "2026-10-01",
      "2026-12-31",
    );
    expect(occ.map((o) => [o.title, o.startDate, o.endDate, o.edited])).toEqual([
      ["Monthly report", "2026-10-01", "2026-10-05", false],
      ["Year-end report", "2026-12-02", "2026-12-09", true],
    ]);
  });

  it("puts all-day events before timed ones, then by time", () => {
    const occ = expandEvents(
      [
        event({ id: "a", title: "Late", startDate: "2026-10-07", endDate: "2026-10-07", allDay: false, startTime: "15:00", endTime: "16:00" }),
        event({ id: "b", title: "Early", startDate: "2026-10-07", endDate: "2026-10-07", allDay: false, startTime: "09:00", endTime: "10:00" }),
        event({ id: "c", title: "All day", startDate: "2026-10-07", endDate: "2026-10-07" }),
      ],
      [],
      "2026-10-01",
      "2026-10-31",
    );
    expect(occ.map((o) => o.title)).toEqual(["All day", "Early", "Late"]);
  });
});

describe("layoutMonth", () => {
  it("covers whole Sunday-first weeks", () => {
    const weeks = layoutMonth("2026-10-01", []);
    expect(weeks[0]!.days[0]).toBe("2026-09-27");
    expect(weeks.at(-1)!.days[6]).toBe("2026-10-31");
    expect(weeks).toHaveLength(5);
  });

  it("splits a bar across weeks and stacks overlaps into lanes", () => {
    const weeks = layoutMonth("2026-10-01", [
      { key: "offsite", startDate: "2026-10-22", endDate: "2026-10-26" },
      { key: "call", startDate: "2026-10-23", endDate: "2026-10-23" },
    ]);
    const w4 = weeks[3]!.segments.map((s) => [s.item.key, s.col, s.span, s.lane, s.continuesAfter]);
    expect(w4).toEqual([
      ["offsite", 4, 3, 0, true],
      ["call", 5, 1, 1, false],
    ]);
    expect(weeks[4]!.segments.map((s) => [s.item.key, s.col, s.span, s.continuesBefore])).toEqual([["offsite", 0, 2, true]]);
  });
});

describe("people", () => {
  it("lets time off win over logged time", () => {
    expect(dayStatus({ leave: "sick", attendance: "present", workday: true })).toBe("sick");
    expect(dayStatus({ leave: null, attendance: "remote", workday: false })).toBe("remote");
    expect(dayStatus({ leave: null, attendance: "present", workday: true })).toBe("present");
    expect(dayStatus({ leave: null, attendance: null, workday: true })).toBe("not_checked_in");
    expect(dayStatus({ leave: null, attendance: null, workday: false })).toBe("off");
    expect(dayStatus({ leave: null, attendance: "off", workday: true })).toBe("off");
  });

  it("measures workload against capacity", () => {
    expect(workloadPct(30, 40)).toBe(75);
    expect(workloadPct(10, 0)).toBeNull();
  });

  it("counts workdays in a leave", () => {
    expect(workdaysIn("2026-10-23", "2026-10-27", [1, 2, 3, 4, 5])).toBe(3);
  });
});

describe("week grid", () => {
  it("lays out one Sunday-first week", () => {
    const w = layoutWeek("2026-10-18", [{ key: "a", startDate: "2026-10-15", endDate: "2026-10-20" }]);
    expect(w.days[0]).toBe("2026-10-18");
    expect(w.segments.map((s) => [s.col, s.span, s.continuesBefore])).toEqual([[0, 3, true]]);
  });

  it("reads clock times as minutes", () => {
    expect(minutesOf("09:30")).toBe(570);
  });

  it("puts overlapping events side by side, others full width", () => {
    const blocks = layoutDay([
      { item: "a", start: 540, end: 600 },
      { item: "b", start: 540, end: 720 },
      { item: "c", start: 600, end: 660 },
      { item: "d", start: 780, end: 840 },
    ]);
    const by = Object.fromEntries(blocks.map((b) => [b.item, [b.col, b.cols]]));
    expect(by).toEqual({ b: [0, 2], a: [1, 2], c: [1, 2], d: [0, 1] });
  });
});

