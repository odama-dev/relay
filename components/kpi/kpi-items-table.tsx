"use client";

import type { ItemResult } from "@/lib/kpi/pure";
import { formatDateShort } from "@/lib/format";
import { DataTable, type Column } from "@/components/data-table";
import { ProgressBar } from "@/components/progress-bar";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

type Row = ItemResult & { templateName?: string; kind?: "core" | "addon"; targetPer?: string; progressOf?: { start: string; end: string } };

const PER: Record<string, string> = { week: " / week", month: " / month", semester: " / 6 months" };

function value(v: number | null, unit: string) {
  if (v === null) return <span className="text-muted-foreground">No data</span>;
  return (
    <span className="tabular">
      {v}
      {unit === "%" ? "%" : ""}
    </span>
  );
}

const tone = (s: number | null) => (s === null ? "muted" : s >= 84 ? "success" : s >= 50 ? "warning" : "destructive");

/** A KPI's items: target, actual, score 0–100 and weight; semester items show progress in a month. */
export function KpiItemsTable({ rows }: { rows: Row[] }) {
  const columns: Column<Row>[] = [
    {
      id: "metric",
      header: "Metric",
      primary: true,
      cell: (r) => r.name,
      sortValue: (r) => r.name,
    },
    { id: "template", header: "Template", cell: (r) => r.templateName ?? "—", sortValue: (r) => r.templateName },
    { id: "data", header: "Data", cell: (r) => (r.manual ? <StatusBadge value="warning" label="Manual — not automated yet" /> : "Automatic"), sortValue: (r) => (r.manual ? 1 : 0) },
    {
      id: "target",
      header: "Target",
      cell: (r) =>
        r.target === null ? (
          <span className="text-muted-foreground">Recorded only</span>
        ) : (
          <span className="tabular">
            {r.direction === "lower" ? "≤ " : "≥ "}
            {r.target}
            {r.unit === "%" ? "%" : ` ${r.unit}`}
            {r.targetPer && r.unit !== "%" ? PER[r.targetPer] ?? "" : ""}
          </span>
        ),
    },
    { id: "actual", header: "Actual", align: "right", cell: (r) => value(r.actual, r.unit), sortValue: (r) => r.actual },
    {
      id: "score",
      header: "Score",
      cell: (r) =>
        r.progressOf ? (
          <span className="text-muted-foreground text-caption">
            Progress since {formatDateShort(r.progressOf.start)} — scored per semester
          </span>
        ) : r.score === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="flex items-center gap-2">
            <ProgressBar value={r.score} tone={tone(r.score)} className="h-1.5 w-20 shrink-0" />
            <span className={cn("tabular w-10 text-right", !r.scored && "text-muted-foreground")}>{Math.round(r.score)}</span>
          </span>
        ),
      sortValue: (r) => r.score,
    },
    {
      id: "weight",
      header: "Weight",
      align: "right",
      cell: (r) => (r.scored ? <span className="tabular">{r.weight}</span> : <StatusBadge value="neutral" label="Not scored" />),
      sortValue: (r) => r.weight,
    },
  ];
  return <DataTable columns={columns} rows={rows} getRowId={(r) => r.metricKey} emptyTitle="No KPI items" />;
}
