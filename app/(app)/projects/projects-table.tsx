"use client";

import type { ProjectListRow } from "@/lib/projects/queries";
import { DataTable, type Column } from "@/components/data-table";
import { StatusDot } from "@/components/status-badge";
import { HealthIndicator } from "@/components/health-indicator";
import { sentenceEnum } from "@/lib/format";

const contractLabel = (c: ProjectListRow["contractType"]) =>
  c === null ? "Internal" : c === "time_and_material" ? "Time & material" : sentenceEnum(c);

const HEALTH_ORDER = { over_budget: 0, warning: 1, on_track: 2, no_budget: 3 } as const;

export function ProjectsTable({ rows, showHealth = true }: { rows: ProjectListRow[]; showHealth?: boolean }) {
  const columns: Column<ProjectListRow>[] = [
    {
      id: "project",
      header: "Project",
      primary: true,
      sortValue: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <span className="flex items-center gap-2">
          <StatusDot value={r.status} />
          {r.name}
        </span>
      ),
    },
    { id: "code", header: "Code", sortValue: (r) => r.code, cell: (r) => <span className="tabular">{r.code}</span> },
    { id: "client", header: "Client", primary: true, sortValue: (r) => r.client?.name ?? "", cell: (r) => r.client?.name ?? "Internal" },
    { id: "pm", header: "PM", sortValue: (r) => r.pm.name, cell: (r) => r.pm.name },
    { id: "contract", header: "Contract", sortValue: (r) => r.contractType ?? "", cell: (r) => contractLabel(r.contractType) },
    ...(showHealth ? [{
      id: "health",
      header: "Health",
      sortValue: (r: ProjectListRow) => (r.health ? HEALTH_ORDER[r.health.status] * 1000 - (r.health.pct ?? 0) : 9999),
      cell: (r: ProjectListRow) => (r.health ? <HealthIndicator health={r.health} /> : "—"),
    } satisfies Column<ProjectListRow>] : []),
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      getRowHref={(r) => `/projects/${r.id}`}
      isRowInactive={(r) => r.status === "archived"}
      emptyTitle="No projects match"
      emptyDescription="Try another search or filter. Archived projects show under Status → Archived."
    />
  );
}
