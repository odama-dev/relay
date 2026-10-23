import { describe, expect, it } from "vitest";
import { parseAmount, validateDeals, type DealImportContext } from "./import";

const ctx: DealImportContext = {
  stages: new Map([
    ["lead", "s-lead"],
    ["won", "s-won"],
  ]),
  clients: new Map([["acme inc", "c-acme"]]),
  people: new Map([["sales@odama.io", "p-sales"]]),
  existing: new Set(["rec_old"]),
  currencies: ["IDR", "USD", "EUR"],
};

describe("Attio deal import", () => {
  it("reads amounts written with either separator", () => {
    expect(parseAmount("1.500.000")).toBe(1500000);
    expect(parseAmount("1,500,000.50")).toBe(1500000.5);
    expect(parseAmount("$12,000")).toBe(12000);
    expect(parseAmount("12.000,75")).toBe(12000.75);
    expect(parseAmount("abc")).toBeNull();
  });

  it("maps known columns, ignores the rest, matches client / stage / owner", () => {
    const res = validateDeals(
      [
        ["Record ID", "Deal name", "Company", "Stage", "Value", "Currency", "Owner", "Attio extra"],
        ["rec_1", "Site", "Acme Inc", "Lead", "1.000.000", "", "sales@odama.io", "x"],
        ["rec_2", "App", "New Co", "won", "5000", "USD", "", ""],
        ["rec_old", "Old", "Acme Inc", "Lead", "10", "IDR", "", ""],
        ["", "", "Acme Inc", "Nope", "x", "JPY", "who", ""],
      ],
      ctx,
      "skip",
    );
    if ("error" in res) throw new Error(res.error);
    const [a, b, c, d] = res.rows;
    expect(a).toMatchObject({ action: "create", data: { clientId: "c-acme", prospectName: null, stageId: "s-lead", value: 1000000, currency: "IDR", ownerId: "p-sales" } });
    expect(b).toMatchObject({ action: "create", data: { clientId: null, prospectName: "New Co", stageId: "s-won", currency: "USD" } });
    expect(c!.action).toBe("skip");
    expect(d!.action).toBe("error");
    expect(d!.errors).toHaveLength(5);
  });

  it("refuses a file without the required columns", () => {
    expect(validateDeals([["Name", "Stage"]], ctx, "skip")).toEqual({ error: "Missing columns: Deal name, Value." });
  });
});
