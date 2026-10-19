"use client";

import { useSearchParams } from "next/navigation";
import type { HealthStatus } from "@/lib/health/pure";
import { HEALTH_LABELS } from "@/lib/health/pure";
import { formatHoursValue } from "@/lib/format";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { HealthIndicator } from "@/components/health-indicator";

export type HealthRow = {
  id: string;
  code: string;
  name: string;
  client: string;
  pm: string;
  retainer: boolean;
  status: HealthStatus;
  pct: number | null;
  usedHours: number;
  budgetHours: number | null;
  overdueTasks: number;
  pendingOos: number;
  risk: number;
};

export function HealthTable({ rows }: { rows: HealthRow[] }) {
  const q = useSearchParams().get("q")?.toLowerCase() ?? "";
  const visible = q ? rows.filter((r) => `${r.code} ${r.name} ${r.client}`.toLowerCase().includes(q)) : rows;
  const columns: Column<HealthRow>[] = [
    { id: "project", header: "Project", primary: true, sortValue: (r) => r.name.toLowerCase(), cell: (r) => r.name },
    { id: "code", header: "Code", sortValue: (r) => r.code, cell: (r) => <span className="tabular">{r.code}</span> },
    { id: "client", header: "Client", primary: true, sortValue: (r) => r.client, cell: (r) => r.client },
    { id: "pm", header: "PM", sortValue: (r) => r.pm, cell: (r) => r.pm },
    { id: "status", header: "Health", sortValue: (r) => r.risk, cell: (r) => <StatusBadge value={r.status} label={HEALTH_LABELS[r.status]} /> },
    { id: "usage", header: "Usage", sortValue: (r) => r.pct ?? -1, cell: (r) => <HealthIndicator health={r} /> },
    {
      id: "hours",
      header: "Hours",
      align: "right",
      sortValue: (r) => r.usedHours,
      cell: (r) => (
        <span>
          {formatHoursValue(r.usedHours)}
          <span>{r.budgetHours !== null ? ` / ${formatHoursValue(r.budgetHours)}${r.retainer ? " mo" : ""}` : ""}</span>
        </span>
      ),
    },
    { id: "overdue", header: "Overdue tasks", align: "right", sortValue: (r) => r.overdueTasks, cell: (r) => <span className={r.overdueTasks ? "text-destructive" : undefined}>{r.overdueTasks}</span> },
    { id: "oos", header: "OOS waiting", align: "right", sortValue: (r) => r.pendingOos, cell: (r) => <span className={r.pendingOos ? "text-warning" : undefined}>{r.pendingOos}</span> },
  ];
  return (
    <DataTable
      columns={columns}
      rows={visible}
      getRowId={(r) => r.id}
      getRowHref={(r) => `/projects/${r.id}?tab=health`}
      emptyTitle="No active projects"
      emptyDescription="Active projects appear here, most at risk first."
    />
  );
}
