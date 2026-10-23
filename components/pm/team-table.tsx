"use client";

import Link from "next/link";
import type { PmMemberRow } from "@/lib/dashboard/queries";
import { LEAVE_KIND_LABELS } from "@/lib/hr/pure";
import { roleLabel } from "@/lib/roles";
import { formatDateShort, formatHours, formatHoursValue, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { MemberAvatar } from "@/components/member-avatar";
import { ProgressBar } from "@/components/progress-bar";

const tone = (pct: number | null) => (pct === null ? "muted" : pct > 100 ? "destructive" : pct >= 70 ? "success" : "warning");

/** Under a row: every running project the person is on today — PM, billable, today's hours, their open tasks. */
function ProjectsToday({ row }: { row: PmMemberRow }) {
  const head = "text-muted-foreground h-8 px-3 text-left text-caption font-normal";
  const hidden = <span className="text-muted-foreground" title="Not a project you're on">—</span>;
  return (
    <div className="bg-hover/50">
      <table className="text-foreground w-full text-body">
        <thead>
          <tr>
            <th className={head}>Project</th>
            <th className={head}>PM</th>
            <th className={head}>Type</th>
            <th className={cn(head, "text-right")}>Today</th>
            <th className={cn(head, "text-right")}>Open tasks</th>
            <th className={head}>Next due</th>
          </tr>
        </thead>
        <tbody>
          {row.projects.map((p) => (
            <tr key={p.id} className="border-border border-t">
              <td className="h-8 px-3">
                <Link href={`/projects/${p.id}`} className="flex min-w-0 items-baseline gap-1.5 outline-none hover:underline focus-visible:underline">
                  <span className="tabular shrink-0">{p.code}</span>
                  <span className="text-muted-foreground truncate">{p.name}</span>
                </Link>
              </td>
              <td className={cn("h-8 px-3", p.mine && "text-muted-foreground")}>{p.mine ? "You" : p.pm}</td>
              <td className="h-8 px-3">{p.billable ? <StatusBadge value="active" label="Billable" /> : <StatusBadge value="draft" label="Internal" />}</td>
              <td className={cn("tabular h-8 px-3 text-right", !p.todayMinutes && "text-muted-foreground")}>{p.mine ? (p.todayMinutes ? formatHours(p.todayMinutes) : "—") : hidden}</td>
              <td className="tabular h-8 px-3 text-right">
                {p.mine ? (
                  <>
                    {p.openTasks}
                    {p.overdueTasks > 0 && <span className="text-destructive"> · {p.overdueTasks} overdue</span>}
                  </>
                ) : (
                  hidden
                )}
              </td>
              <td className={cn("tabular h-8 px-3", !p.nextDue && "text-muted-foreground")}>{p.mine ? (p.nextDue ? formatDateShort(p.nextDue) : "—") : hidden}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {row.projects.length === 0 && <p className="text-muted-foreground px-3 py-2 text-body">No running projects today.</p>}
    </div>
  );
}

/**
 * Everyone on your projects: today (hours, or the leave they're on), the
 * projects they're on, open tasks on yours and billable utilization this
 * week. The chevron opens today's projects.
 */
export function PmTeamTable({ rows }: { rows: PmMemberRow[] }) {
  const columns: Column<PmMemberRow>[] = [
    {
      id: "name",
      header: "Person",
      primary: true,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <MemberAvatar seed={r.id} src={r.avatarUrl} size={20} className="shrink-0" />
          <span className="truncate">{r.name}</span>
        </span>
      ),
      sortValue: (r) => r.name,
    },
    { id: "role", header: "Role", cell: (r) => roleLabel(r.role), sortValue: (r) => roleLabel(r.role) },
    {
      id: "today",
      header: "Today",
      cell: (r) =>
        r.away ? (
          <StatusBadge value="in_progress" label={LEAVE_KIND_LABELS[r.away]} />
        ) : (
          <span className={cn("tabular", !r.todayMinutes && "text-muted-foreground")}>{r.todayMinutes ? `${formatHours(r.todayMinutes)} logged` : "Nothing logged"}</span>
        ),
      sortValue: (r) => (r.away ? -1 : r.todayMinutes),
    },
    {
      id: "projects",
      header: "Projects today",
      cell: (r) => {
        const billable = r.projects.filter((p) => p.billable).length;
        return (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="tabular shrink-0">{r.projects.length}</span>
            <span className="text-muted-foreground truncate text-caption">{billable ? `${billable} billable` : "internal only"}</span>
          </span>
        );
      },
      sortValue: (r) => r.projects.length,
    },
    {
      id: "tasks",
      header: "Open tasks",
      align: "right",
      cell: (r) => {
        const mine = r.projects.filter((p) => p.mine);
        const open = mine.reduce((n, p) => n + p.openTasks, 0);
        const overdue = mine.reduce((n, p) => n + p.overdueTasks, 0);
        return (
          <span className="tabular" title="On your projects">
            {open}
            {overdue > 0 && <span className="text-destructive"> · {overdue} overdue</span>}
          </span>
        );
      },
      sortValue: (r) => r.projects.reduce((n, p) => n + (p.mine ? p.openTasks : 0), 0),
    },
    {
      id: "util",
      header: "Utilization this week",
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2" title={`${formatHours(r.weekBillableMinutes)} billable of ${formatHoursValue(r.capacityHours)} available · ${formatHours(r.weekMinutes)} logged in all`}>
          <ProgressBar value={Math.min(100, r.utilization ?? 0)} tone={tone(r.utilization)} className="h-1.5 w-20 shrink-0" />
          <span className="tabular w-10 text-right">{r.utilization === null ? "—" : formatPercent(r.utilization)}</span>
          <span className="text-muted-foreground tabular truncate text-caption">
            {formatHoursValue(r.weekBillableMinutes / 60)} / {formatHoursValue(r.capacityHours)}
          </span>
        </span>
      ),
      sortValue: (r) => r.utilization,
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      pageSize={20}
      emptyTitle="Nobody on your projects yet"
      renderExpanded={(r) => <ProjectsToday row={r} />}
      isRowExpandable={(r) => r.projects.length > 0}
      expandLabel={(r) => `Show the projects ${r.name} is on today`}
    />
  );
}
