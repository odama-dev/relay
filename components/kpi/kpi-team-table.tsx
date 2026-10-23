"use client";

import { DataTable, type Column } from "@/components/data-table";
import { MemberAvatar } from "@/components/member-avatar";
import { ProgressBar } from "@/components/progress-bar";
import { StatusBadge } from "@/components/status-badge";

export type KpiTeamRow = { id: string; name: string; avatarUrl: string | null; jobRole: string | null; score: number | null; grade: string | null; calibration: boolean; hasKpi: boolean; items: number };

const tone = (s: number | null) => (s === null ? "muted" : s >= 84 ? "success" : s >= 50 ? "warning" : "destructive");

/** The month so far for everyone the viewer may see — their reports, or the studio. */
export function KpiTeamTable({ rows }: { rows: KpiTeamRow[] }) {
  const columns: Column<KpiTeamRow>[] = [
    {
      id: "name",
      header: "Person",
      primary: true,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <MemberAvatar seed={r.id} src={r.avatarUrl} size={24} />
          <span className="truncate">{r.name}</span>
        </span>
      ),
      sortValue: (r) => r.name,
    },
    { id: "role", header: "Job role", cell: (r) => r.jobRole ?? <span className="text-muted-foreground">—</span>, sortValue: (r) => r.jobRole },
    {
      id: "score",
      header: "Month so far",
      cell: (r) =>
        !r.hasKpi ? (
          <span className="text-muted-foreground">No KPI set</span>
        ) : (
          <span className="flex items-center gap-2">
            <ProgressBar value={r.score ?? 0} tone={tone(r.score)} className="h-1.5 w-24 shrink-0" />
            <span className="tabular w-10 text-right">{r.score === null ? "—" : Math.round(r.score)}</span>
          </span>
        ),
      sortValue: (r) => r.score,
    },
    { id: "grade", header: "Grade", cell: (r) => r.grade ?? "—", sortValue: (r) => r.grade },
    { id: "flags", header: "", cell: (r) => (r.calibration ? <StatusBadge value="neutral" label="Calibration" /> : null) },
  ];
  return <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} getRowHref={(r) => `/kpi?person=${r.id}`} pageSize={20} emptyTitle="Nobody reports to you yet" />;
}
