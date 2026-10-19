"use client";

import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/format";

type Run = { id: string; job: string; startedAt: Date; finishedAt: Date | null; ok: boolean | null; result: string | null };

/** The last scheduled-job runs (PRD: every job logs its result). */
export function JobsPanel({ runs }: { runs: Run[] }) {
  const columns: Column<Run>[] = [
    { id: "job", header: "Job", cell: (r) => r.job },
    { id: "started", header: "Started", cell: (r) => formatDateTime(r.startedAt) },
    {
      id: "status",
      header: "Status",
      cell: (r) => <StatusBadge value={r.ok === null ? "pending" : r.ok ? "done" : "blocked"} label={r.ok === null ? "Running" : r.ok ? "OK" : "Failed"} />,
    },
    { id: "result", header: "Result", cell: (r) => <span className="block max-w-md truncate font-mono">{r.result ?? "—"}</span> },
  ];
  return (
    <DataTable
      columns={columns}
      rows={runs}
      getRowId={(r) => r.id}
      emptyTitle="No job runs yet"
      emptyDescription="The VPS cron calls /api/cron/<job> with CRON_SECRET. See docs/VPS_DEPLOY.md."
    />
  );
}
