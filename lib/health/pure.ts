import type { RolloverMode } from "@prisma/client";
import type { IsoDate } from "@/lib/time/pure";

/**
 * Project health math (PRD M4 "Cara menghitung"). Pure — the queries in
 * lib/health/queries.ts feed it minute totals and settings, every screen and
 * job reads the result from here.
 *
 *  - in-scope   = entries with oos_status none | rejected   → counts against budget
 *  - pending    = oos_status pending                       → shown apart, not counted yet
 *  - approved   = oos_status approved                      → change request, never counted
 */

export type HealthStatus = "on_track" | "warning" | "over_budget" | "no_budget";

export type OosMinutes = { inScope: number; pending: number; approved: number };

export type BudgetSnapshot = {
  budgetHours: number | null;
  usedHours: number;
  remainingHours: number | null;
  /** used ÷ budget × 100; null without a budget. */
  pct: number | null;
  pendingOosHours: number;
  approvedOosHours: number;
  status: HealthStatus;
  /** Thresholds the usage has reached, ascending. */
  passedThresholds: number[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function normalizeThresholds(thresholds: number[]): number[] {
  return [...new Set(thresholds.filter((t) => Number.isInteger(t) && t > 0))].sort((a, b) => a - b);
}

/**
 * On track below the first threshold, Warning once it's reached, Over
 * budget past 100% (M4.1). A project without a budget only reports hours.
 */
export function healthStatus(pct: number | null, thresholds: number[]): HealthStatus {
  if (pct === null) return "no_budget";
  if (pct > 100) return "over_budget";
  const first = normalizeThresholds(thresholds)[0] ?? 100;
  return pct >= first ? "warning" : "on_track";
}

export function snapshot(budgetHours: number | null, minutes: OosMinutes, thresholds: number[]): BudgetSnapshot {
  const usedHours = round2(minutes.inScope / 60);
  const hasBudget = budgetHours !== null && budgetHours > 0;
  const pct = hasBudget ? round2((usedHours / budgetHours) * 100) : null;
  return {
    budgetHours: hasBudget ? budgetHours : null,
    usedHours,
    remainingHours: hasBudget ? round2(budgetHours - usedHours) : null,
    pct,
    pendingOosHours: round2(minutes.pending / 60),
    approvedOosHours: round2(minutes.approved / 60),
    status: healthStatus(pct, thresholds),
    passedThresholds: pct === null ? [] : normalizeThresholds(thresholds).filter((t) => pct >= t),
  };
}

export type RetainerSettings = { hoursPerMonth: number; rolloverMode: RolloverMode; capHours: number | null };

export type RetainerMonthInput = {
  month: IsoDate;
  /** The settings that month ran with (frozen), or the current ones. */
  settings: RetainerSettings;
  minutes: OosMinutes;
};

export type RetainerMonth = BudgetSnapshot & {
  month: IsoDate;
  baseHours: number;
  rolloverInHours: number;
  /** Hours carried into the next month under this month's rollover mode. */
  rolloverOutHours: number;
  settings: RetainerSettings;
};

/** What a month passes on: nothing, everything left, or up to the cap. Never negative. */
export function carryOver(budgetHours: number, usedHours: number, settings: RetainerSettings): number {
  const left = Math.max(0, budgetHours - usedHours);
  switch (settings.rolloverMode) {
    case "none":
      return 0;
    case "full":
      return round2(left);
    case "capped":
      return round2(Math.min(left, Math.max(0, settings.capHours ?? 0)));
  }
}

/**
 * Retainer budget per month (M4): this month's hours + what the previous
 * month rolled over, under the previous month's own mode. Overspending never
 * reduces the next month (rollover is floored at 0). Months must be
 * consecutive and in order.
 */
export function retainerMonths(months: RetainerMonthInput[], thresholds: number[]): RetainerMonth[] {
  const out: RetainerMonth[] = [];
  let carry = 0;
  for (const m of months) {
    const base = m.settings.hoursPerMonth;
    const budget = round2(base + carry);
    const snap = snapshot(budget, m.minutes, thresholds);
    const rolloverOut = carryOver(budget, snap.usedHours, m.settings);
    out.push({ ...snap, month: m.month, baseHours: base, rolloverInHours: carry, rolloverOutHours: rolloverOut, settings: m.settings });
    carry = rolloverOut;
  }
  return out;
}

/** Sort key for the overview (M4.5): most at risk first. */
export function riskScore(s: { status: HealthStatus; pct: number | null; overdueTasks: number; pendingOos: number }): number {
  const base = { over_budget: 3000, warning: 2000, on_track: 1000, no_budget: 0 }[s.status];
  return base + Math.min(s.pct ?? 0, 999) + s.overdueTasks * 5 + s.pendingOos;
}

export const HEALTH_LABELS: Record<HealthStatus, string> = {
  on_track: "On track",
  warning: "Warning",
  over_budget: "Over budget",
  no_budget: "No budget",
};
