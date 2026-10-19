import { describe, expect, it } from "vitest";
import { defaultKind, expenseTotals } from "./pure";

describe("expense totals", () => {
  it("sums per currency and splits opex from capex without float drift", () => {
    const totals = expenseTotals([
      { amount: 0.1, currency: "USD", kind: "opex" },
      { amount: 0.2, currency: "USD", kind: "opex" },
      { amount: 1200, currency: "USD", kind: "capex" },
      { amount: 450_000, currency: "IDR", kind: "opex" },
    ]);
    expect(totals).toEqual([
      { currency: "IDR", total: 450_000, opex: 450_000, capex: 0, count: 1 },
      { currency: "USD", total: 1200.3, opex: 0.3, capex: 1200, count: 3 },
    ]);
  });

  it("returns nothing for no expenses", () => {
    expect(expenseTotals([])).toEqual([]);
  });

  it("treats equipment as capex by default, everything else as opex", () => {
    expect(defaultKind("equipment")).toBe("capex");
    expect(defaultKind("software")).toBe("opex");
    expect(defaultKind("utilities")).toBe("opex");
  });
});
