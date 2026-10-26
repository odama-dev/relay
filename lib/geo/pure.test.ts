import { describe, expect, it } from "vitest";
import { countryCounts, normalizeCountry } from "./pure";

describe("country tracker", () => {
  it("maps codes and spellings onto the map's names", () => {
    expect(normalizeCountry("US")).toBe("United States of America");
    expect(normalizeCountry(" united states ")).toBe("United States of America");
    expect(normalizeCountry("UK")).toBe("United Kingdom");
    expect(normalizeCountry("indonesia")).toBe("Indonesia");
    expect(normalizeCountry("new  zealand")).toBe("New Zealand");
    expect(normalizeCountry("")).toBeNull();
    expect(normalizeCountry(null)).toBeNull();
    // A picked country is kept exactly, even where title case would change it.
    expect(normalizeCountry("côte d'ivoire")).toBe("Côte d'Ivoire");
    expect(normalizeCountry("eSwatini")).toBe("eSwatini");
    expect(normalizeCountry("Bosnia and Herzegovina")).toBe("Bosnia and Herz.");
  });

  it("counts per country, most first, and the ones without a country apart", () => {
    const { rows, unknown } = countryCounts(["Indonesia", "indonesia", "US", "United States", "Singapore", null, " "]);
    expect(rows).toEqual([
      { name: "Indonesia", label: "Indonesia", count: 2 },
      { name: "United States of America", label: "United States", count: 2 },
      { name: "Singapore", label: "Singapore", count: 1 },
    ]);
    expect(unknown).toBe(2);
  });
});
