import type { Division, OosStatus, UserRole } from "@prisma/client";
import { BILLABLE_DIVISIONS } from "@/lib/roles";
import { addDays, weekStart, type IsoDate } from "@/lib/time/pure";
import { availableHours, round2 } from "@/lib/clevel/pure";

/**
 * Metric Dictionary (PRD Phase 2): the one definition behind every number on
 * a dashboard. Screens and loaders import from here — two dashboards showing
 * the same metric must return the same value. The words for each metric are
 * in ./definitions.ts.
 */

// ---------------------------------------------------------------------------
// Week
// ---------------------------------------------------------------------------

/**
 * The metric week: Monday–Friday are its working days; a task due on
 * Saturday or Sunday belongs to the same week.
 */
export function metricWeek(d: IsoDate): { start: IsoDate; end: IsoDate } {
  const start = weekStart(d);
  return { start, end: addDays(start, 6) };
}

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------

/**
 * Billable: logged on a client project's task (the entry's derived flag) and
 * not waiting on an out-of-scope decision. Approved out-of-scope work counts.
 */
export function isBillableEntry(e: { isBillable: boolean; oosStatus: OosStatus | string }): boolean {
  return e.isBillable && e.oosStatus !== "pending";
}

/** Logged hours: every entry dated in the period, non-billable included. */
export function loggedMinutes(entries: { minutes: number }[]): number {
  return entries.reduce((s, e) => s + e.minutes, 0);
}

export function billableMinutes(entries: { minutes: number; isBillable: boolean; oosStatus: OosStatus | string }[]): number {
  return loggedMinutes(entries.filter(isBillableEntry));
}

// ---------------------------------------------------------------------------
// Capacity, utilization, workload
// ---------------------------------------------------------------------------

/**
 * Capacity: contract hours per week spread over the workdays, less approved
 * leave (a capacity override) and public holidays, while employed. Zero when
 * the person has no contract hours.
 */
export function capacityHours(
  capacity: { effectiveFrom: IsoDate; weeklyHours: number }[],
  overrides: { start: IsoDate; end: IsoDate; availableHours: number }[],
  window: { start: IsoDate; end: IsoDate },
  workdays: number[],
  holidays: ReadonlySet<IsoDate> = new Set(),
  employment: { activeFrom: IsoDate; activeTo: IsoDate | null } = { activeFrom: "1900-01-01", activeTo: null },
): number {
  return availableHours(capacity, overrides, employment, window, workdays, holidays) ?? 0;
}

/**
 * Utilization only means something for billable divisions (Design,
 * Development, Project). Without a division, the Phase 1 roles that bill.
 */
export function countsForUtilization(p: { division: Division | null; role: UserRole }): boolean {
  return p.division ? BILLABLE_DIVISIONS.includes(p.division) : p.role === "designer_dev" || p.role === "pm";
}

/** Utilization: billable hours ÷ capacity, in percent (2 decimals); null without capacity. */
export function utilizationPct(billableHours: number, capacity: number | null): number | null {
  if (!capacity || capacity <= 0) return null;
  return round2((billableHours / capacity) * 100);
}

/**
 * Workload: estimated hours of open tasks due in the period (overdue
 * included) ÷ capacity, in percent. Not utilization — a different label and
 * colour wherever it's shown.
 */
export function workloadPct(plannedHours: number, capacity: number): number | null {
  if (capacity <= 0) return null;
  return Math.round((plannedHours / capacity) * 100);
}

/**
 * Workload is "pushed by overdue" when overdue estimates make up at least
 * half of it — piled-up late work, not new work.
 */
export function workloadFromOverdue(overdueHours: number, plannedHours: number): boolean {
  return plannedHours > 0 && overdueHours / plannedHours >= 0.5;
}

// ---------------------------------------------------------------------------
// Margin
// ---------------------------------------------------------------------------

/**
 * A running fixed-price project is shown as budget burn against progress,
 * not as a (misleading) negative margin: hours used ÷ budget vs tasks done ÷
 * tasks. Null parts when there's no budget or no tasks.
 */
export function burnVsProgress(p: { usedHours: number; budgetHours: number | null; doneTasks: number; totalTasks: number }): {
  burnPct: number | null;
  progressPct: number | null;
  ahead: boolean | null;
} {
  const burnPct = p.budgetHours && p.budgetHours > 0 ? Math.round((p.usedHours / p.budgetHours) * 100) : null;
  const progressPct = p.totalTasks > 0 ? Math.round((p.doneTasks / p.totalTasks) * 100) : null;
  return { burnPct, progressPct, ahead: burnPct === null || progressPct === null ? null : burnPct > progressPct };
}
