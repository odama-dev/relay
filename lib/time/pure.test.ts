import { describe, expect, it } from "vitest";
import {
  addMonths,
  dueBucket,
  isoWeekday,
  monthsBetween,
  parseDuration,
  timeIn,
  todayIn,
  weekDays,
  weekStart,
} from "./pure";

describe("parseDuration", () => {
  it.each([
    ["1h 30m", 90],
    ["1h30m", 90],
    ["2h15", 135],
    ["1h", 60],
    ["45m", 45],
    ["90 min", 90],
    ["1.5", 90],
    ["1,5", 90],
    ["0.25", 15],
    ["1:30", 90],
    ["8", 480],
    ["2 jam", 120],
  ])("%s → %d minutes", (input, minutes) => {
    expect(parseDuration(input)).toBe(minutes);
  });

  it.each(["", "abc", "0", "0h", "25h", "1:75", "-1", "h"])("rejects %j", (input) => {
    expect(parseDuration(input)).toBeNull();
  });
});

describe("calendar", () => {
  it("starts weeks on Monday", () => {
    expect(weekStart("2026-10-13")).toBe("2026-10-12"); // Tuesday
    expect(weekStart("2026-10-12")).toBe("2026-10-12"); // Monday
    expect(weekStart("2026-10-18")).toBe("2026-10-12"); // Sunday
    expect(isoWeekday("2026-10-18")).toBe(7);
    expect(weekDays("2026-10-12")).toHaveLength(7);
    expect(weekDays("2026-10-12")[6]).toBe("2026-10-18");
  });

  it("walks months across year ends", () => {
    expect(addMonths("2026-11-01", 2)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(monthsBetween("2026-10-20", "2027-01-05")).toEqual([
      "2026-10-01",
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
    ]);
  });

  it("reads today and the clock in WIB", () => {
    const utc = new Date("2026-10-13T18:30:00Z"); // 01:30 on the 14th in Jakarta
    expect(todayIn("Asia/Jakarta", utc)).toBe("2026-10-14");
    expect(timeIn("Asia/Jakarta", utc)).toBe("01:30");
  });
});

describe("dueBucket", () => {
  const today = "2026-10-14"; // Wednesday
  it("groups My Tasks", () => {
    expect(dueBucket("2026-10-13", today)).toBe("overdue");
    expect(dueBucket(today, today)).toBe("today");
    expect(dueBucket("2026-10-18", today)).toBe("this_week");
    expect(dueBucket("2026-10-19", today)).toBe("later");
    expect(dueBucket(null, today)).toBe("none");
  });
});
