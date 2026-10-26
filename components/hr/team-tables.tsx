"use client";

import { useState } from "react";
import type { DayStatus } from "@/lib/hr/pure";
import type { TodayRow } from "@/lib/hr/queries";
import { roleLabel } from "@/lib/roles";
import { formatDateShort, formatHours, formatHoursValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { MemberAvatar } from "@/components/member-avatar";
import { ProgressBar } from "@/components/progress-bar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const STATUS: Record<DayStatus, { value: string; label: string }> = {
  present: { value: "on_track", label: "In office" },
  remote: { value: "on_track", label: "Remote" },
  not_checked_in: { value: "warning", label: "Not checked in" },
  annual_leave: { value: "in_progress", label: "Annual leave" },
  permit: { value: "in_progress", label: "Permit" },
  sick: { value: "over_budget", label: "Sick" },
  other_leave: { value: "in_progress", label: "On leave" },
  off: { value: "no_budget", label: "Day off" },
};

function Person({ row }: { row: { id: string; name: string; avatarUrl: string | null } }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <MemberAvatar seed={row.id} src={row.avatarUrl} size={20} className="shrink-0" />
      <span className="truncate">{row.name}</span>
    </span>
  );
}

// Workload has its own colour (brand) so it never reads as utilization:
// red over capacity, amber when overdue work is what fills it.
const tone = (pct: number | null, fromOverdue: boolean) => (pct === null ? "muted" : pct > 100 ? "destructive" : fromOverdue ? "warning" : "brand");

/** "Wireframes ACM-001" for one project, "2 projects · ACM-001, NUS-001" for several, else the task in progress. */
function WorkingOn({ row }: { row: TodayRow }) {
  const projects = row.day.filter((d) => d.code);
  if (row.day.length === 1 || (projects.length === 1 && row.day.length === 2)) {
    const d = projects[0] ?? row.day[0]!;
    return (
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="truncate">{d.tasks[0]!.title}</span>
        {d.code && <span className="text-muted-foreground tabular shrink-0 text-caption">{d.code}</span>}
      </span>
    );
  }
  if (projects.length > 1)
    return (
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0">{projects.length} projects</span>
        <span className="text-muted-foreground tabular truncate text-caption">{projects.map((d) => d.code).join(", ")}</span>
      </span>
    );
  if (row.inProgressTask)
    return (
      <span className="flex min-w-0 items-baseline gap-1.5" title="In progress (nothing logged yet today)">
        <span className="truncate">{row.inProgressTask.title}</span>
        <span className="text-muted-foreground tabular shrink-0 text-caption">{row.inProgressTask.code} · in progress</span>
      </span>
    );
  return <span className="text-muted-foreground">—</span>;
}

/** Under a row: one line per task logged today — project, task, status, due date, hours. */
function DayDetail({ row, today }: { row: TodayRow; today: string }) {
  const lines = row.day.flatMap((d) => d.tasks.map((t) => ({ ...t, project: d })));
  const head = "text-muted-foreground h-8 px-3 text-left text-caption font-normal";
  return (
    <div className="bg-hover/50">
      <table className="text-foreground w-full text-body">
        <thead>
          <tr>
            <th className={head}>Project</th>
            <th className={head}>Task</th>
            <th className={head}>Status</th>
            <th className={head}>Due date</th>
            <th className={cn(head, "text-right")}>Hours</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((t) => (
            <tr key={`${t.project.key}:${t.key}`} className="border-border border-t">
              <td className="h-8 px-3">
                {t.project.code ? (
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="tabular shrink-0">{t.project.code}</span>
                    <span className="text-muted-foreground truncate">{t.project.name}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Non-project</span>
                )}
              </td>
              <td className="h-8 px-3">{t.title}</td>
              <td className="h-8 px-3">{t.status ? <StatusBadge value={t.status} /> : <span className="text-muted-foreground">—</span>}</td>
              <td className={cn("tabular h-8 px-3", t.dueDate && t.dueDate < today && t.status !== "done" ? "text-destructive" : !t.dueDate && "text-muted-foreground")}>
                {t.dueDate ? formatDateShort(t.dueDate) : "—"}
              </td>
              <td className="tabular h-8 px-3 text-right">{formatHours(t.minutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Every member today: status, hours, what they're on (a chevron opens time per
 * project and task, with due dates) and their workload this week (a name
 * opens their open to-do).
 */
export function TeamTodayTable({ rows, today }: { rows: TodayRow[]; today: string }) {
  const [todo, setTodo] = useState<TodayRow | null>(null);
  const columns: Column<TodayRow>[] = [
    {
      id: "name",
      header: "Person",
      primary: true,
      cell: (r) => (
        <button type="button" onClick={() => setTodo(r)} className="min-w-0 text-left outline-none hover:underline focus-visible:underline" aria-label={`Open ${r.name}'s to-do`}>
          <Person row={r} />
        </button>
      ),
      sortValue: (r) => r.name,
    },
    { id: "role", header: "Role", cell: (r) => roleLabel(r.role), sortValue: (r) => roleLabel(r.role) },
    { id: "status", header: "Status", cell: (r) => <StatusBadge value={STATUS[r.status].value} label={STATUS[r.status].label} />, sortValue: (r) => r.status },
    { id: "hours", header: "Today", align: "right", cell: (r) => <span className={cn("tabular", !r.minutes && "text-muted-foreground")}>{r.minutes ? formatHours(r.minutes) : "—"}</span>, sortValue: (r) => r.minutes },
    { id: "on", header: "Working on", cell: (r) => <WorkingOn row={r} /> },
    {
      id: "load",
      header: "Workload this week (planned ÷ capacity)",
      cell: ({ workload: w }) => (
        <span
          className="flex min-w-0 items-center gap-2"
          title={`Workload, not utilization: ${formatHoursValue(w.plannedHours)} of estimated open tasks due this week against ${formatHoursValue(w.capacityHours)} available · ${w.open} open, ${w.overdue} overdue${w.fromOverdue ? " · mostly overdue work" : ""}${w.noEstimate ? ` · ${w.noEstimate} without an estimate` : ""}`}
        >
          <ProgressBar value={Math.min(100, w.pct ?? 0)} tone={tone(w.pct, w.fromOverdue)} className="h-1.5 w-20 shrink-0" />
          <span className={cn("tabular w-10 text-right", w.pct !== null && w.pct > 100 && "text-destructive")}>{w.pct === null ? "—" : `${w.pct}%`}</span>
          <span className="text-muted-foreground tabular truncate text-caption">
            {formatHoursValue(w.plannedHours)} / {formatHoursValue(w.capacityHours)}
            {w.fromOverdue && " · overdue"}
          </span>
        </span>
      ),
      sortValue: (r) => r.workload.pct,
    },
  ];
  const w = todo?.workload;
  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        pageSize={20}
        emptyTitle="Nobody to show"
        renderExpanded={(r) => <DayDetail row={r} today={today} />}
        isRowExpandable={(r) => r.day.length > 0}
        expandLabel={(r) => `Show what ${r.name} worked on today`}
      />
      <Sheet open={todo !== null} onOpenChange={(o) => !o && setTodo(null)}>
        <SheetContent className="w-[min(28rem,calc(100vw-2rem))]">
          {todo && w && (
            <>
              <SheetHeader>
                <SheetTitle>{todo.name}&apos;s to-do</SheetTitle>
                <SheetDescription>
                  {w.open} open · {w.overdue} overdue · {w.pct === null ? "no capacity set" : `${w.pct}% of this week`}
                </SheetDescription>
              </SheetHeader>
              <ul className="flex flex-col divide-y overflow-y-auto px-4 pb-4">
                {w.tasks.length === 0 && <li className="text-muted-foreground py-3 text-body">No open tasks.</li>}
                {w.tasks.map((t) => {
                  const late = t.dueDate !== null && t.dueDate < today;
                  return (
                    <li key={t.id} className="flex items-start gap-3 py-2.5">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-body">{t.title}</span>
                        <span className="text-muted-foreground tabular text-caption">
                          {t.projectCode}
                          {t.estimateHours !== null && ` · ${formatHoursValue(t.estimateHours)}`}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <StatusBadge value={t.status} />
                        {t.dueDate && <span className={cn("tabular text-caption", late ? "text-destructive" : "text-muted-foreground")}>{formatDateShort(t.dueDate)}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
