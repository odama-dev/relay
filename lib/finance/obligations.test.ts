import { describe, expect, it } from "vitest";
import { agingByClient, obligationDates } from "./obligations";

describe("obligation dates", () => {
  it("repeats monthly and falls back to a short month's last day", () => {
    expect(obligationDates({ recurrence: "monthly", dayOfMonth: 31, month: null, onDate: null }, "2026-01-15", "2026-04-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("keeps yearly ones to their month and one-offs to their day", () => {
    expect(obligationDates({ recurrence: "yearly", dayOfMonth: 30, month: 4, onDate: null }, "2026-01-01", "2027-12-31")).toEqual(["2026-04-30", "2027-04-30"]);
    expect(obligationDates({ recurrence: "once", dayOfMonth: 5, month: null, onDate: "2026-11-05" }, "2026-11-01", "2026-11-30")).toEqual(["2026-11-05"]);
    expect(obligationDates({ recurrence: "once", dayOfMonth: 5, month: null, onDate: "2026-12-05" }, "2026-11-01", "2026-11-30")).toEqual([]);
  });
});

describe("aging by client", () => {
  it("buckets what each client owes by days late, in IDR", () => {
    const rows = agingByClient(
      [
        { clientId: "a", client: "Acme", due: "2026-10-30", idr: 100 },
        { clientId: "a", client: "Acme", due: "2026-10-10", idr: 50 },
        { clientId: "b", client: "Beta", due: "2026-08-01", idr: 70 },
        { clientId: "b", client: "Beta", due: "2026-09-10", idr: null },
      ],
      "2026-10-22",
    );
    expect(rows.map((r) => r.client)).toEqual(["Beta", "Acme"]);
    expect(rows[0]).toMatchObject({ total: 70, unconverted: 1, buckets: { late_60_plus: 70 } });
    expect(rows[1]).toMatchObject({ total: 150, buckets: { not_due: 100, late_1_30: 50, late_31_60: 0 } });
  });
});
