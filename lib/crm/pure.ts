import { z } from "zod";
import { isIsoDate } from "@/lib/time/pure";

/**
 * Sales CRM columns (Companies and People, Attio-style). A record keeps its
 * custom values in one JSON object keyed by the column's id; each type
 * normalises what comes in, so the table only ever renders clean values.
 */

export const CRM_ATTRIBUTE_TYPES = ["text", "number", "currency", "date", "checkbox", "select", "multi_select", "url", "email", "phone"] as const;
export type CrmAttributeType = (typeof CRM_ATTRIBUTE_TYPES)[number];

export const CRM_TYPE_LABELS: Record<CrmAttributeType, string> = {
  text: "Text",
  number: "Number",
  currency: "Currency (IDR)",
  date: "Date",
  checkbox: "Checkbox",
  select: "Select",
  multi_select: "Multi-select (tags)",
  url: "URL",
  email: "Email",
  phone: "Phone",
};

/** Option colours a select can use (Badge palette). */
export const OPTION_COLORS = ["gray", "blue", "green", "amber", "red", "purple", "teal", "orange"] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];
export type CrmOption = { id: string; label: string; color: OptionColor };

export const optionsSchema = z
  .array(z.object({ id: z.string().min(1).max(40), label: z.string().trim().min(1, "Name the option").max(60), color: z.enum(OPTION_COLORS).catch("gray") }))
  .max(50, "Up to 50 options");

export type CrmValue = string | number | boolean | string[] | null;

const url = z.string().trim().max(500).transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`)).pipe(z.string().url("Enter a valid URL"));

/**
 * The stored form of a value for a column, or an error. Empty input
 * (blank text, no tags, unchecked is still `false`) clears it to null.
 */
export function normalizeValue(type: CrmAttributeType, options: CrmOption[], raw: unknown): { ok: true; value: CrmValue } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: type === "checkbox" ? false : null };
  const fail = (error: string) => ({ ok: false as const, error });
  switch (type) {
    case "text":
    case "phone": {
      const s = String(raw).trim();
      if (s.length > (type === "text" ? 2000 : 40)) return fail("Too long");
      return { ok: true, value: s || null };
    }
    case "number":
    case "currency": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[^\d.-]/g, ""));
      if (!Number.isFinite(n)) return fail("Enter a number");
      return { ok: true, value: type === "currency" ? Math.round(n) : Math.round(n * 1e6) / 1e6 };
    }
    case "date":
      return isIsoDate(raw) ? { ok: true, value: raw as string } : fail("Enter a valid date");
    case "checkbox":
      return { ok: true, value: raw === true || raw === "true" };
    case "select": {
      const id = String(raw);
      return options.some((o) => o.id === id) ? { ok: true, value: id } : fail("Choose one of the options");
    }
    case "multi_select": {
      const ids = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      if (ids.some((id) => !options.some((o) => o.id === id))) return fail("Choose from the options");
      return { ok: true, value: ids.length ? [...new Set(ids)] : null };
    }
    case "url": {
      const r = url.safeParse(String(raw));
      return r.success ? { ok: true, value: r.data } : fail("Enter a valid URL");
    }
    case "email": {
      const r = z.string().trim().toLowerCase().email().safeParse(String(raw));
      return r.success ? { ok: true, value: r.data } : fail("Enter a valid email");
    }
  }
}

/** A value as plain text — for sorting, search and CSV. */
export function valueText(type: CrmAttributeType, options: CrmOption[], v: CrmValue): string {
  if (v === null || v === undefined) return "";
  if (type === "checkbox") return v ? "Yes" : "No";
  if (type === "select") return options.find((o) => o.id === v)?.label ?? "";
  if (type === "multi_select") return (v as string[]).map((id) => options.find((o) => o.id === id)?.label ?? "").filter(Boolean).join(", ");
  return String(v);
}

/** Sort key: numbers stay numbers, everything else sorts as text. */
export function valueSort(type: CrmAttributeType, options: CrmOption[], v: CrmValue): string | number | null {
  if (v === null || v === undefined) return null;
  if (type === "number" || type === "currency") return v as number;
  if (type === "checkbox") return v ? 1 : 0;
  return valueText(type, options, v).toLowerCase();
}

/** A new option id, short and stable (labels can be renamed). */
export const newOptionId = () => Math.random().toString(36).slice(2, 10);

export type ConnectionStrength = "very_strong" | "strong" | "weak" | "none";

export const CONNECTION_LABELS: Record<ConnectionStrength, string> = { very_strong: "Very strong", strong: "Strong", weak: "Weak", none: "No connection" };

const DAY = 86_400_000;

/**
 * How well the team knows someone, from the email with them: a two-way
 * thread in the last 30 days and 6+ emails in 90 → very strong; a two-way
 * thread in 90 days, or 3+ emails → strong; any email in a year → weak.
 */
export function connectionStrength(mail: { sentAt: string; direction: "inbound" | "outbound" }[], now: Date): ConnectionStrength {
  const age = (m: { sentAt: string }) => (now.getTime() - new Date(m.sentAt).getTime()) / DAY;
  const within = (days: number) => mail.filter((m) => age(m) <= days);
  const twoWay = (list: typeof mail) => list.some((m) => m.direction === "inbound") && list.some((m) => m.direction === "outbound");
  const d30 = within(30);
  const d90 = within(90);
  if (twoWay(d30) && d90.length >= 6) return "very_strong";
  if (twoWay(d90) || d90.length >= 3) return "strong";
  if (within(365).length > 0) return "weak";
  return "none";
}

/** Company size and revenue ranges (checked in crm_companies_employee_range / _estimated_arr). */
export const EMPLOYEE_RANGES = ["1-10", "11-50", "51-200", "201-500", "501-1k", "1k-5k", "5k-10k", "10k-50k", "50k+"] as const;
export type EmployeeRange = (typeof EMPLOYEE_RANGES)[number];
export const EMPLOYEE_RANGE_LABELS: Record<EmployeeRange, string> = {
  "1-10": "1–10",
  "11-50": "11–50",
  "51-200": "51–200",
  "201-500": "201–500",
  "501-1k": "501–1,000",
  "1k-5k": "1,000–5,000",
  "5k-10k": "5,000–10,000",
  "10k-50k": "10,000–50,000",
  "50k+": "50,000+",
};

export const ARR_RANGES = ["0-1m", "1m-10m", "10m-50m", "50m-100m", "100m-250m", "250m-500m", "500m-1b", "1b-10b", "10b+"] as const;
export type ArrRange = (typeof ARR_RANGES)[number];
export const ARR_RANGE_LABELS: Record<ArrRange, string> = {
  "0-1m": "$0–$1M",
  "1m-10m": "$1M–$10M",
  "10m-50m": "$10M–$50M",
  "50m-100m": "$50M–$100M",
  "100m-250m": "$100M–$250M",
  "250m-500m": "$250M–$500M",
  "500m-1b": "$500M–$1B",
  "1b-10b": "$1B–$10B",
  "10b+": "$10B+",
};

/** In the order the forms list them. */
export const SOCIALS = ["angellist", "facebook", "instagram", "linkedin", "twitter"] as const;
export type Social = (typeof SOCIALS)[number];
export const SOCIAL_LABELS: Record<Social, string> = { linkedin: "LinkedIn", twitter: "Twitter", instagram: "Instagram", facebook: "Facebook", angellist: "AngelList" };
const SOCIAL_HOSTS: Record<Social, string> = { linkedin: "linkedin.com/in/", twitter: "x.com/", instagram: "instagram.com/", facebook: "facebook.com/", angellist: "wellfound.com/u/" };

/** A social profile as a link: a full URL stays, a handle ("@kopisenja") becomes the network's profile URL. */
export function socialHref(network: Social, value: string): string {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w.-]+\.[a-z]{2,}\//i.test(v)) return `https://${v}`;
  return `https://${SOCIAL_HOSTS[network]}${v.replace(/^@/, "")}`;
}

/** "https://www.Kopi-Senja.id/about" → "kopi-senja.id"; null when it isn't a domain. */
export function normalizeDomain(raw: string): string | null {
  const d = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(d) ? d : null;
}
