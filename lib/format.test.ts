import { describe, expect, it } from "vitest";
import {
  amountToInput,
  formatAmountInput,
  formatDate,
  formatDuration,
  formatHours,
  formatMoney,
  parseAmountInput,
  sentenceEnum,
} from "./format";

describe("amount inputs", () => {
  it("groups thousands with commas", () => {
    expect(formatAmountInput("6000000")).toBe("6,000,000");
    expect(formatAmountInput("6,0000,00")).toBe("6,000,000");
    expect(formatAmountInput("IDR 15,900,000")).toBe("15,900,000");
    expect(formatAmountInput("007")).toBe("7");
    expect(formatAmountInput("")).toBe("");
  });

  it("keeps a dot decimal only where decimals are allowed", () => {
    expect(formatAmountInput("1250.5", 2)).toBe("1,250.5");
    expect(formatAmountInput("1250.", 2)).toBe("1,250.");
    expect(formatAmountInput(".5", 2)).toBe("0.5");
    expect(formatAmountInput("1250.567", 2)).toBe("1,250.56");
    expect(formatAmountInput("1250.5")).toBe("12,505");
  });

  it("parses back to a number", () => {
    expect(parseAmountInput("6,000,000")).toBe(6_000_000);
    expect(parseAmountInput("1,250.50")).toBe(1250.5);
    expect(parseAmountInput("")).toBeNaN();
  });

  it("round-trips form values", () => {
    expect(amountToInput(6_000_000)).toBe("6,000,000");
    expect(amountToInput(1250.5, 2)).toBe("1,250.5");
    expect(amountToInput(Number.NaN)).toBe("");
    expect(amountToInput(undefined)).toBe("");
  });
});

describe("money", () => {
  it("formats per currency", () => {
    expect(formatMoney(15_900_000, "IDR")).toBe("IDR 15,900,000");
    expect(formatMoney(1250.5, "USD")).toBe("$1,250.50");
    expect(formatMoney(1250.5, "SGD")).toBe("SGD 1,250.50");
    expect(formatMoney(1250.5, "AUD")).toBe("A$1,250.50");
    expect(formatMoney(Number.NaN, "USD")).toBe("—");
  });
});

describe("time", () => {
  it("formats durations and hour totals", () => {
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatHours(90)).toBe("1.5h");
    expect(formatHours(20)).toBe("0.33h");
  });

  it("formats calendar dates in UTC", () => {
    expect(formatDate(new Date("2026-10-13T00:00:00Z"))).toBe("13 Oct 2026");
    expect(formatDate(null)).toBe("—");
  });

  it("sentence-cases enums", () => {
    expect(sentenceEnum("in_progress")).toBe("In progress");
    expect(sentenceEnum("on_hold")).toBe("On hold");
  });
});

describe("formatClock", () => {
  it("prints 12-hour times", async () => {
    const { formatClock } = await import("./format");
    expect(["00:05", "09:00", "12:30", "15:00"].map(formatClock)).toEqual(["12:05 AM", "9:00 AM", "12:30 PM", "3:00 PM"]);
  });
});
