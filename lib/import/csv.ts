/**
 * Minimal RFC 4180 CSV (PRD "Format umum"): UTF-8, comma separated, double
 * quotes escape commas, quotes ("") and line breaks. A BOM is ignored.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully empty lines.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

export type CsvRecord = { line: number; values: Record<string, string> };

/** Header row → records keyed by column name. Line numbers are 1-based, header = line 1. */
export function toRecords(
  rows: string[][],
  columns: readonly string[],
): { ok: true; records: CsvRecord[] } | { ok: false; error: string } {
  const [header, ...body] = rows;
  if (!header) return { ok: false, error: "The file is empty." };
  const names = header.map((h) => h.trim().replace(/\*$/, ""));
  const unknown = names.filter((n) => !columns.includes(n));
  if (unknown.length) return { ok: false, error: `Unknown columns: ${unknown.join(", ")}. Use the template header.` };
  const missing = columns.filter((c) => !names.includes(c));
  if (missing.length) return { ok: false, error: `Missing columns: ${missing.join(", ")}. Use the template header.` };
  return {
    ok: true,
    records: body.map((cells, i) => ({
      line: i + 2,
      values: Object.fromEntries(names.map((n, j) => [n, (cells[j] ?? "").trim()])),
    })),
  };
}
