import { isIsoDate, type IsoDate } from "@/lib/time/pure";
import { normalizeLeadSource, resolveStageName } from "@/lib/sales/pure";

/**
 * Deals from an Attio CSV export (PRD Phase 2 "Migrasi"). Attio exports many
 * columns; the ones below are read by name (case-insensitive), the rest are
 * ignored. Stage is matched to a pipeline stage by name, Company to a
 * client by name (otherwise it stays a prospect), Owner by email or name.
 * Record ID makes a re-import update instead of duplicating.
 */

export const DEAL_IMPORT_COLUMNS = {
  externalId: "Record ID",
  title: "Deal name",
  company: "Company",
  stage: "Stage",
  value: "Value",
  currency: "Currency",
  owner: "Owner",
  expectedClose: "Expected close",
  leadSource: "Lead source",
  serviceType: "Service type",
  lostReason: "Lost reason",
  createdAt: "Created at",
  closedAt: "Closed at",
} as const;
type Field = keyof typeof DEAL_IMPORT_COLUMNS;
const REQUIRED: Field[] = ["title", "stage", "value"];

export const DEAL_IMPORT_TEMPLATE =
  Object.values(DEAL_IMPORT_COLUMNS).join(",") +
  "\nrec_01,Website redesign,Acme Inc,Proposal,150000000,IDR,sales@odama.io,2026-12-15,Referral,Website,,2026-09-01,\n";

export type DealImport = {
  externalId: string | null;
  title: string;
  clientId: string | null;
  prospectName: string | null;
  stageId: string;
  value: number;
  currency: string;
  ownerId: string | null;
  expectedClose: IsoDate | null;
  leadSource: string | null;
  serviceType: string | null;
  lostReason: string | null;
  createdAt: Date | null;
  closedAt: Date | null;
};

export type DealImportRow = { line: number; key: string; action: "create" | "update" | "skip" | "error"; errors: string[]; data?: DealImport };

export type DealImportContext = {
  stages: Map<string, string>; // lower-cased name → id
  clients: Map<string, string>; // lower-cased name → id
  people: Map<string, string>; // lower-cased email or name → id
  existing: Set<string>; // external ids already imported
  currencies: readonly string[];
};

/** "1.500.000", "1,500,000.50", "$12,000" → number; null when it isn't one. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[^\d.,-]/g, "");
  if (!s) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  // The later separator is the decimal one when it has 1–2 digits after it.
  const dec = Math.max(lastDot, lastComma);
  if (dec >= 0 && s.length - dec - 1 <= 2 && s.length - dec - 1 > 0) {
    s = s.slice(0, dec).replace(/[.,]/g, "") + "." + s.slice(dec + 1);
  } else {
    s = s.replace(/[.,]/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** yyyy-mm-dd, or an ISO timestamp cut to its date. */
function parseDay(raw: string): IsoDate | null {
  const d = raw.slice(0, 10);
  return isIsoDate(d) ? d : null;
}

/** Header names → field, ignoring Attio's other columns. */
export function mapHeader(header: string[]): { ok: true; index: Partial<Record<Field, number>> } | { ok: false; error: string } {
  const index: Partial<Record<Field, number>> = {};
  const wanted = Object.entries(DEAL_IMPORT_COLUMNS) as [Field, string][];
  header.forEach((h, i) => {
    const hit = wanted.find(([, name]) => name.toLowerCase() === h.trim().toLowerCase());
    if (hit) index[hit[0]] = i;
  });
  const missing = REQUIRED.filter((f) => index[f] === undefined).map((f) => DEAL_IMPORT_COLUMNS[f]);
  return missing.length ? { ok: false, error: `Missing columns: ${missing.join(", ")}.` } : { ok: true, index };
}

export function validateDeals(rows: string[][], ctx: DealImportContext, mode: "skip" | "update"): { error: string } | { rows: DealImportRow[] } {
  const [header, ...body] = rows;
  if (!header) return { error: "The file is empty." };
  const mapped = mapHeader(header);
  if (!mapped.ok) return { error: mapped.error };
  if (!body.length) return { error: "The file has no rows under the header." };
  if (body.length > 2000) return { error: "Import at most 2,000 deals at a time." };
  const seen = new Set<string>();

  return {
    rows: body.map((cells, i) => {
      const get = (f: Field) => (mapped.index[f] === undefined ? "" : (cells[mapped.index[f]!] ?? "").trim());
      const line = i + 2;
      const errors: string[] = [];
      const externalId = get("externalId") || null;
      const title = get("title");
      if (!title) errors.push("Deal name is empty");
      const stageId = resolveStageName(get("stage"), ctx.stages);
      if (!stageId) errors.push(`Unknown stage "${get("stage")}" — add it to the pipeline first`);
      const value = parseAmount(get("value"));
      if (value === null) errors.push(`Value "${get("value")}" isn't an amount`);
      const currency = (get("currency") || "IDR").toUpperCase();
      if (!ctx.currencies.includes(currency)) errors.push(`Currency ${currency} isn't enabled`);
      const ownerRaw = get("owner").toLowerCase();
      const ownerId = ownerRaw ? (ctx.people.get(ownerRaw) ?? null) : null;
      if (ownerRaw && !ownerId) errors.push(`Owner "${get("owner")}" isn't a person in Odama OS`);
      const company = get("company");
      const clientId = company ? (ctx.clients.get(company.toLowerCase()) ?? null) : null;
      if (!company) errors.push("Company is empty");
      const day = (f: Field) => {
        const raw = get(f);
        if (!raw) return null;
        const d = parseDay(raw);
        if (!d) errors.push(`${DEAL_IMPORT_COLUMNS[f]} "${raw}" isn't a date (yyyy-mm-dd)`);
        return d;
      };
      const expectedClose = day("expectedClose");
      const createdOn = day("createdAt");
      const closedOn = day("closedAt");
      if (externalId) {
        if (seen.has(externalId)) errors.push("Record ID appears twice in the file");
        seen.add(externalId);
      }
      const key = externalId ?? title;
      if (errors.length) return { line, key, action: "error", errors };
      const exists = externalId !== null && ctx.existing.has(externalId);
      if (exists && mode === "skip") return { line, key, action: "skip", errors: [] };
      return {
        line,
        key,
        action: exists ? "update" : "create",
        errors: [],
        data: {
          externalId,
          title,
          clientId,
          prospectName: clientId ? null : company,
          stageId: stageId!,
          value: value!,
          currency,
          ownerId,
          expectedClose,
          leadSource: normalizeLeadSource(get("leadSource")),
          serviceType: get("serviceType") || null,
          lostReason: get("lostReason") || null,
          createdAt: createdOn ? new Date(`${createdOn}T12:00:00+07:00`) : null,
          closedAt: closedOn ? new Date(`${closedOn}T12:00:00+07:00`) : null,
        },
      };
    }),
  };
}
