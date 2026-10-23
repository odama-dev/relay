import { describe, expect, it } from "vitest";
import { normalizeValue, valueSort, valueText, type CrmOption } from "./pure";

const opts: CrmOption[] = [
  { id: "a", label: "Hot", color: "red" },
  { id: "b", label: "Warm", color: "amber" },
];

describe("CRM values", () => {
  it("normalises each type and clears empty input", () => {
    expect(normalizeValue("text", [], "  hi ")).toEqual({ ok: true, value: "hi" });
    expect(normalizeValue("number", [], "1,250.5")).toEqual({ ok: true, value: 1250.5 });
    expect(normalizeValue("currency", [], 1500000.4)).toEqual({ ok: true, value: 1500000 });
    expect(normalizeValue("date", [], "2026-10-22")).toEqual({ ok: true, value: "2026-10-22" });
    expect(normalizeValue("date", [], "22/10/2026").ok).toBe(false);
    expect(normalizeValue("checkbox", [], "")).toEqual({ ok: true, value: false });
    expect(normalizeValue("url", [], "odama.io")).toEqual({ ok: true, value: "https://odama.io" });
    expect(normalizeValue("email", [], "Hi@Odama.IO")).toEqual({ ok: true, value: "hi@odama.io" });
    expect(normalizeValue("text", [], "")).toEqual({ ok: true, value: null });
  });

  it("keeps selects to their options and de-duplicates tags", () => {
    expect(normalizeValue("select", opts, "a")).toEqual({ ok: true, value: "a" });
    expect(normalizeValue("select", opts, "z").ok).toBe(false);
    expect(normalizeValue("multi_select", opts, ["a", "b", "a"])).toEqual({ ok: true, value: ["a", "b"] });
    expect(normalizeValue("multi_select", opts, [])).toEqual({ ok: true, value: null });
  });

  it("reads values back as text and sort keys", () => {
    expect(valueText("multi_select", opts, ["b", "a"])).toBe("Warm, Hot");
    expect(valueText("checkbox", [], true)).toBe("Yes");
    expect(valueSort("currency", [], 5)).toBe(5);
    expect(valueSort("select", opts, "a")).toBe("hot");
    expect(valueSort("text", [], null)).toBeNull();
  });
});
