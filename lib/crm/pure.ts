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
