"use client";

import { useState } from "react";
import { toast } from "sonner";
import { toCsv } from "@/lib/import/csv";
import { IMPORT_COLUMNS, IMPORT_EXAMPLES, type ImportKind } from "@/lib/import/templates";
import type { ImportRowResult } from "@/lib/import/run";
import { Button } from "@/components/ui/button";
import { icons } from "@/components/icon";
import { SelectField } from "@/components/select-field";
import { StatusBadge } from "@/components/status-badge";
import { DataTable, type Column } from "@/components/data-table";
import { FormField } from "@/components/form-field";
import { cn } from "@/lib/utils";
import { previewCsv, runCsvImport, sendPendingInvites } from "./actions";

const STEPS: { kind: ImportKind; label: string; note: string }[] = [
  { kind: "users", label: "1. Users", note: "Imported people stay Invited until you send invitations." },
  { kind: "clients", label: "2. Clients", note: "Matched by name. The contact becomes the primary contact." },
  { kind: "projects", label: "3. Projects", note: "Matched by name + client. Codes are generated from the client code." },
];

const ACTION_TONE: Record<string, string> = {
  create: "sent",
  created: "paid",
  update: "review",
  updated: "paid",
  skip: "draft",
  skipped: "draft",
  error: "overdue",
};

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * One-off import from Notion / spreadsheets (PRD "Import CSV"): upload,
 * preview every row, choose skip or update for existing records, import the
 * valid rows, download a per-row result.
 */
export function ImportPanel() {
  const [kind, setKind] = useState<ImportKind>("users");
  const [mode, setMode] = useState<"skip" | "update">("skip");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [rows, setRows] = useState<ImportRowResult[] | null>(null);
  const [imported, setImported] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setRows(null);
    setImported(false);
  };

  const preview = async (text: string, m = mode) => {
    setBusy(true);
    const res = await previewCsv({ kind, text, mode: m });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      setRows(null);
      return;
    }
    setRows(res.data.rows);
    setImported(false);
  };

  const runImport = async () => {
    if (!file) return;
    setBusy(true);
    const res = await runCsvImport({ kind, text: file.text, mode });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    setRows(res.data.rows);
    setImported(true);
    const done = res.data.rows.filter((r) => r.action === "created" || r.action === "updated").length;
    toast.success(`Imported ${done} of ${res.data.rows.length} rows`);
  };

  const counts = rows?.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.action]: (acc[r.action] ?? 0) + 1 }), {});
  const importable = (counts?.create ?? 0) + (counts?.update ?? 0);

  const columns: Column<ImportRowResult>[] = [
    { id: "line", header: "Line", sortValue: (r) => r.line, cell: (r) => <span className="tabular">{r.line}</span>, className: "w-16" },
    { id: "key", header: "Record", cell: (r) => <span className="truncate">{r.key.replace(/^[0-9a-f-]{36}:|^internal:/, "")}</span> },
    { id: "action", header: "Result", sortValue: (r) => r.action, cell: (r) => <StatusBadge value={ACTION_TONE[r.action] ?? "draft"} label={r.action} /> },
    { id: "errors", header: "Errors", cell: (r) => <span className="text-destructive whitespace-normal">{r.errors.join("; ")}</span> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Import step">
        {STEPS.map((s) => (
          <button
            key={s.kind}
            role="tab"
            aria-selected={kind === s.kind}
            onClick={() => {
              setKind(s.kind);
              setFile(null);
              reset();
            }}
            className={cn(
              "rounded-lg px-3 py-1.5 text-body transition-colors",
              kind === s.kind ? "bg-active text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="text-muted-foreground -mt-3 text-body">
        Import in order: users → clients → projects. {STEPS.find((s) => s.kind === kind)!.note} Dates are YYYY-MM-DD, numbers use a dot
        decimal without thousands separators, lists are separated by semicolons.
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <Button variant="tertiary" size="sm" onClick={() => download(`${kind}.csv`, toCsv([[...IMPORT_COLUMNS[kind]], IMPORT_EXAMPLES[kind]]))} leadingIcon={icons.csv}>
          Template {kind}.csv
        </Button>
        <FormField label="CSV file" htmlFor="imp-file">
          <input
            id="imp-file"
            type="file"
            accept=".csv,text/csv"
            className="file:bg-accent file:text-foreground text-muted-foreground text-body file:mr-3 file:rounded-full file:border-0 file:px-3 file:py-1"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const text = await f.text();
              setFile({ name: f.name, text });
              await preview(text);
            }}
          />
        </FormField>
        <FormField label="Existing records" htmlFor="imp-mode">
          <SelectField
            id="imp-mode"
            className="w-44"
            value={mode}
            onChange={(v) => {
              const m = v as "skip" | "update";
              setMode(m);
              if (file) void preview(file.text, m);
            }}
            options={[
              { value: "skip", label: "Skip them" },
              { value: "update", label: "Update them" },
            ]}
          />
        </FormField>
      </div>

      {rows && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-body">
              {Object.entries(counts ?? {}).map(([action, n]) => (
                <span key={action} className="mr-3">
                  <span className="tabular">{n}</span> <span className="text-muted-foreground">{action}</span>
                </span>
              ))}
            </p>
            <div className="flex gap-2">
              <Button
                variant="tertiary"
                size="sm"
                onClick={() =>
                  download(
                    `${kind}-${imported ? "result" : "preview"}.csv`,
                    toCsv([["line", "record", "result", "errors"], ...rows.map((r) => [r.line, r.key, r.action, r.errors.join("; ")])]),
                  )
                }
              >
                Download {imported ? "result" : "preview"}
              </Button>
              {!imported && (
                <Button size="sm" disabled={busy || importable === 0} onClick={runImport}>
                  {busy ? "Importing…" : `Import ${importable} valid row${importable === 1 ? "" : "s"}`}
                </Button>
              )}
              {imported && kind === "users" && (
                <Button
                  size="sm"
                  onClick={async () => {
                    const res = await sendPendingInvites();
                    if (!res.ok) return void toast.error(res.error);
                    toast.success(`Sent ${res.data.sent} invitations${res.data.failed ? `; ${res.data.failed} failed (check email setup)` : ""}`);
                  }}
                >
                  Send invitations
                </Button>
              )}
            </div>
          </div>
          <DataTable columns={columns} rows={rows} getRowId={(r) => `${r.line}`} pageSize={50} />
        </>
      )}
    </div>
  );
}
