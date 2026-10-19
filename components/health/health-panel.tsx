"use client";

import { useState } from "react";
import type { ProjectHealth, Breakdown } from "@/lib/health/queries";
import { HEALTH_LABELS } from "@/lib/health/pure";
import { formatHours, formatHoursValue, formatMonth, formatPercent } from "@/lib/format";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { icons } from "@/components/icon";
import { EmptyState } from "@/components/states";
import { ProgressBar } from "@/components/progress-bar";
import { HEALTH_TONE } from "@/components/health-indicator";
import { BudgetDialog } from "./budget-dialog";
import type { BudgetInput } from "@/lib/validation";

type Month = ProjectHealth["months"][number];

/**
 * M4.1 — budget vs actual: budget, used, remaining, %, out-of-scope waiting
 * and approved; for retainers the current month, its rollover and history.
 */
export function HealthPanel({
  projectId,
  health,
  budget,
  retainer,
  canEditBudget,
  breakdown,
}: {
  projectId: string;
  health: ProjectHealth;
  budget: BudgetInput;
  retainer: boolean;
  canEditBudget: boolean;
  breakdown: { bySection: Breakdown; byPerson: Breakdown } | null;
}) {
  const [editing, setEditing] = useState(false);
  const c = health.current;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <StatusBadge value={c.status} label={HEALTH_LABELS[c.status]} />
          <span className="text-muted-foreground text-body">
            {retainer ? `${formatMonth(health.periodStart)} · ` : ""}
            Alerts at {health.thresholds.map((t) => `${t}%`).join(", ")}
          </span>
        </div>
        {canEditBudget && (
          <Button variant="tertiary" size="sm" onClick={() => setEditing(true)} leadingIcon={icons.edit}>
            Budget & alerts
          </Button>
        )}
      </div>

      {c.budgetHours !== null && (
        <div className="flex flex-col gap-1.5">
          <ProgressBar value={c.pct ?? 0} tone={HEALTH_TONE[c.status]} label="Budget used" className="h-3.5">
            {health.thresholds.filter((t) => t < 100).map((t) => (
              <span key={t} className="bg-background/70 absolute inset-y-0 w-px" style={{ left: `${t}%` }} aria-hidden />
            ))}
          </ProgressBar>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label={retainer ? "Budget this month" : "Budget"} value={c.budgetHours !== null ? formatHoursValue(c.budgetHours) : "—"} sublabel={retainer && health.mode === "retainer" ? `incl. ${formatHoursValue((health.current as Month).rolloverInHours)} rollover` : undefined} />
        <StatCard label="Used (in scope)" value={formatHoursValue(c.usedHours)} />
        <StatCard label="Remaining" value={c.remainingHours !== null ? formatHoursValue(c.remainingHours) : "—"} />
        <StatCard label="Used" value={formatPercent(c.pct)} />
        <StatCard label="Out of scope · waiting" value={formatHoursValue(c.pendingOosHours)} sublabel="Not counted until the PM decides" />
        <StatCard label="Out of scope · approved" value={formatHoursValue(c.approvedOosHours)} sublabel="Change requests" />
      </div>

      {retainer && health.months.length > 0 && <RetainerHistory months={health.months} />}

      {breakdown && (
        <div className="grid gap-6 lg:grid-cols-2">
          <BreakdownList title="By section" rows={breakdown.bySection} />
          <BreakdownList title="By person" rows={breakdown.byPerson} />
        </div>
      )}

      {editing && <BudgetDialog open onOpenChange={setEditing} projectId={projectId} retainer={retainer} initial={budget} />}
    </div>
  );
}

function RetainerHistory({ months }: { months: Month[] }) {
  const rows = [...months].reverse();
  const columns: Column<Month>[] = [
    { id: "month", header: "Month", cell: (m) => formatMonth(m.month) },
    { id: "base", header: "Hours", align: "right", cell: (m) => formatHoursValue(m.baseHours) },
    { id: "in", header: "Rollover in", align: "right", cell: (m) => formatHoursValue(m.rolloverInHours) },
    { id: "budget", header: "Budget", align: "right", cell: (m) => formatHoursValue(m.budgetHours ?? 0) },
    { id: "used", header: "Used", align: "right", cell: (m) => formatHoursValue(m.usedHours) },
    { id: "out", header: "Carried over", align: "right", cell: (m) => <span>{formatHoursValue(m.rolloverOutHours)} · {m.settings.rolloverMode}</span> },
    { id: "status", header: "Status", cell: (m) => <StatusBadge value={m.status} label={HEALTH_LABELS[m.status]} /> },
  ];
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-body font-medium">Monthly history</h3>
      <DataTable columns={columns} rows={rows} getRowId={(m) => m.month} pageSize={12} />
    </section>
  );
}

function BreakdownList({ title, rows }: { title: string; rows: Breakdown }) {
  const max = Math.max(1, ...rows.map((r) => r.minutes));
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-body font-medium">{title}</h3>
      {rows.length === 0 ? (
        <EmptyState icon="timesheet" title="No hours this period" fill={false} className="py-8" />
      ) : (
        <ul className="bg-surface-3 shadow-surface-2 flex flex-col gap-2 rounded-xl p-3">
          {rows.map((r) => (
            <li key={r.id ?? r.name} className="flex items-center gap-3 text-body">
              <span className="w-36 shrink-0 truncate">{r.name}</span>
              <ProgressBar value={(r.minutes / max) * 100} tone="neutral" className="flex-1" />
              <span className="tabular w-14 text-right">{formatHours(r.minutes)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
