"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DEAL_IMPORT_COLUMNS, DEAL_IMPORT_TEMPLATE } from "@/lib/sales/import";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/select-field";
import { FormField } from "@/components/form-field";
import { StatusBadge } from "@/components/status-badge";
import { Icon, icons } from "@/components/icon";
import { importDeals, previewDealImport } from "./actions";

type Row = { line: number; key: string; action: string; errors: string[] };
const ACTION_LABEL: Record<string, { tone: string; label: string }> = {
  create: { tone: "paid", label: "New" },
  update: { tone: "sent", label: "Update" },
  skip: { tone: "void", label: "Skip" },
  error: { tone: "overdue", label: "Error" },
};

/**
 * Deals from Attio (PRD "Migrasi"): export the deals view as CSV, preview
 * what happens to each row, then import the valid ones. Record ID makes a
 * second import update instead of duplicating.
 */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [mode, setMode] = useState<"skip" | "update">("skip");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = async (text: string, m: "skip" | "update") => {
    setBusy(true);
    setError(null);
    const res = await previewDealImport({ text, mode: m });
    setBusy(false);
    if (!res.ok) {
      setRows(null);
      return setError(res.error);
    }
    setRows(res.data.rows);
  };
  const ready = rows?.filter((r) => r.action === "create" || r.action === "update").length ?? 0;
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(DEAL_IMPORT_TEMPLATE)}`;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="lg" className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import deals from Attio</DialogTitle>
          <DialogDescription>
            Export your deals as CSV. Read by column name: {Object.values(DEAL_IMPORT_COLUMNS).join(", ")}; other columns are ignored. Stages must exist in
            the pipeline; companies that aren&apos;t clients stay prospects.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label="CSV file"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const text = await f.text();
                setFile({ name: f.name, text });
                await preview(text, mode);
              }}
            />
            <Button variant="tertiary" size="sm" leadingIcon={icons.upload} onClick={() => fileRef.current?.click()} disabled={busy}>
              {file ? "Choose another file" : "Choose CSV"}
            </Button>
            <FormField label="Deals already imported" htmlFor="imp-mode" className="w-56">
              <SelectField
                id="imp-mode"
                value={mode}
                onChange={(v) => {
                  setMode(v as "skip" | "update");
                  if (file) void preview(file.text, v as "skip" | "update");
                }}
                options={[
                  { value: "skip", label: "Skip them" },
                  { value: "update", label: "Update them" },
                ]}
              />
            </FormField>
            <a href={template} download="attio-deals-template.csv" className="text-muted-foreground flex h-9 items-center gap-1.5 text-body underline underline-offset-2">
              <Icon name="csv" size={14} />
              Template
            </a>
          </div>
          {file && <p className="text-muted-foreground text-caption">{file.name}</p>}
          {error && <p role="alert" className="text-destructive text-body">{error}</p>}
          {rows && (
            <ul className="flex max-h-72 flex-col overflow-y-auto rounded-lg border text-body">
              {rows.map((r) => (
                <li key={r.line} className="flex items-start gap-3 border-b px-3 py-2 last:border-b-0">
                  <span className="text-muted-foreground tabular w-10 text-caption">#{r.line}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.key}</span>
                    {r.errors.map((e) => (
                      <span key={e} className="text-destructive block text-caption">
                        {e}
                      </span>
                    ))}
                  </span>
                  <StatusBadge value={ACTION_LABEL[r.action]!.tone} label={ACTION_LABEL[r.action]!.label} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy || !file || ready === 0}
            onClick={async () => {
              setBusy(true);
              const res = await importDeals({ text: file!.text, mode });
              setBusy(false);
              if (!res.ok) return setError(res.error);
              const r = res.data;
              toast.success(`Imported: ${r.created} new, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped` : ""}${r.failed ? `, ${r.failed} with errors left out` : ""}`);
              onClose();
              router.refresh();
            }}
          >
            {busy ? "Working…" : `Import ${ready} deal${ready === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
