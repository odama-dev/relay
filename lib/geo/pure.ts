import { COUNTRIES } from "@/lib/geo/countries";

/**
 * The country tracker: a company's country (picked from COUNTRIES) or a
 * client's free-text `clients.country`, mapped onto the names the world map
 * uses (world-atlas, Natural Earth 1:110m), counted per country.
 */

const EXACT = new Map<string, string>(COUNTRIES.map((c) => [c.toLowerCase(), c]));

/** Spellings and codes people type, lowercased → the map's name. */
const ALIASES: Record<string, string> = {
  us: "United States of America",
  usa: "United States of America",
  "u.s.": "United States of America",
  "u.s.a.": "United States of America",
  "united states": "United States of America",
  america: "United States of America",
  uk: "United Kingdom",
  "u.k.": "United Kingdom",
  gb: "United Kingdom",
  "great britain": "United Kingdom",
  england: "United Kingdom",
  scotland: "United Kingdom",
  id: "Indonesia",
  ina: "Indonesia",
  sg: "Singapore",
  my: "Malaysia",
  au: "Australia",
  nz: "New Zealand",
  de: "Germany",
  nl: "Netherlands",
  "the netherlands": "Netherlands",
  holland: "Netherlands",
  fr: "France",
  jp: "Japan",
  kr: "South Korea",
  korea: "South Korea",
  "republic of korea": "South Korea",
  ae: "United Arab Emirates",
  uae: "United Arab Emirates",
  hk: "Hong Kong",
  ca: "Canada",
  ch: "Switzerland",
  ph: "Philippines",
  th: "Thailand",
  vn: "Vietnam",
  "viet nam": "Vietnam",
  in: "India",
  cn: "China",
  prc: "China",
  sa: "Saudi Arabia",
  ksa: "Saudi Arabia",
  "bosnia and herzegovina": "Bosnia and Herz.",
  "central african republic": "Central African Rep.",
  "dr congo": "Dem. Rep. Congo",
  "democratic republic of the congo": "Dem. Rep. Congo",
  "dominican republic": "Dominican Rep.",
  "equatorial guinea": "Eq. Guinea",
  "south sudan": "S. Sudan",
  "solomon islands": "Solomon Is.",
  "north macedonia": "Macedonia",
  eswatini: "eSwatini",
  "czech republic": "Czechia",
};

/** Countries too small for the 1:110m map, drawn as a dot at [longitude, latitude]. */
export const COUNTRY_POINTS: Record<string, [number, number]> = {
  Singapore: [103.82, 1.35],
  "Hong Kong": [114.17, 22.32],
  Bahrain: [50.56, 26.07],
  Malta: [14.38, 35.94],
  Monaco: [7.42, 43.74],
  Maldives: [73.22, 3.2],
  Mauritius: [57.55, -20.35],
  Luxembourg: [6.13, 49.61],
};

/** A typed country onto the map's name; unknown spellings keep their own (trimmed, title-cased) name. Empty stays empty. */
export function normalizeCountry(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!v) return null;
  const exact = EXACT.get(v.toLowerCase());
  if (exact) return exact;
  const alias = ALIASES[v.toLowerCase()];
  if (alias) return alias;
  return v
    .toLowerCase()
    .split(" ")
    .map((w) => (["of", "and", "the"].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Map names that read badly as labels → how people write them. */
const LABELS: Record<string, string> = {
  "United States of America": "United States",
  "Bosnia and Herz.": "Bosnia and Herzegovina",
  "Central African Rep.": "Central African Republic",
  "Dem. Rep. Congo": "DR Congo",
  "Dominican Rep.": "Dominican Republic",
  "Eq. Guinea": "Equatorial Guinea",
  "Falkland Is.": "Falkland Islands",
  "S. Sudan": "South Sudan",
  "Solomon Is.": "Solomon Islands",
  "W. Sahara": "Western Sahara",
  Macedonia: "North Macedonia",
  eSwatini: "Eswatini",
};

/** A map name as people read it ("United States of America" → "United States"). */
export function countryLabel(name: string) {
  return LABELS[name] ?? name;
}

/** Records per country, most first (ties by name); ones without a country are counted apart. */
export function countryCounts(countries: (string | null | undefined)[]) {
  const counts = new Map<string, number>();
  let unknown = 0;
  for (const raw of countries) {
    const name = normalizeCountry(raw);
    if (name === null) unknown++;
    else counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const rows = [...counts].map(([name, count]) => ({ name, label: countryLabel(name), count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { rows, unknown };
}
