import "server-only";
import type { ContractType, OosStatus, RolloverMode } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { numOr0, num } from "@/lib/money";
import { addDays, addMonths, isoDate, monthStart, monthsBetween, todayIn, type IsoDate } from "@/lib/time/pure";
import {
  normalizeThresholds,
  retainerMonths,
  snapshot,
  type BudgetSnapshot,
  type OosMinutes,
  type RetainerMonth,
  type RetainerSettings,
} from "@/lib/health/pure";

/**
 * Project health from the time log (M4). Usage is summed over every entry of
 * the project, so these run on the system connection — callers must first
 * check the viewer may see the budget (an RLS read of `project_budgets`).
 */

export type HealthInput = {
  id: string;
  contractType: ContractType | null;
  startDate: Date;
  budget: {
    budgetHours: Prisma.Decimal | null;
    retainerHoursPerMonth: Prisma.Decimal | null;
    rolloverMode: RolloverMode;
    rolloverCapHours: Prisma.Decimal | null;
    alertThresholds: number[];
  } | null;
};

export type ProjectHealth = {
  /** "total" for fixed / T&M / internal; "retainer" for monthly budgets. */
  mode: "total" | "retainer";
  /** The budget period: the project start, or the current month (retainer). */
  periodStart: IsoDate;
  current: BudgetSnapshot;
  thresholds: number[];
  months: RetainerMonth[];
};

type Row = { project_id: string; month: Date; oos_status: OosStatus; minutes: number };

const empty = (): OosMinutes => ({ inScope: 0, pending: 0, approved: 0 });

function add(target: OosMinutes, status: OosStatus, minutes: number) {
  if (status === "pending") target.pending += minutes;
  else if (status === "approved") target.approved += minutes;
  else target.inScope += minutes; // none | rejected count against the budget
}

export async function computeHealth(projects: HealthInput[], today: IsoDate = todayIn()): Promise<Map<string, ProjectHealth>> {
  const out = new Map<string, ProjectHealth>();
  if (projects.length === 0) return out;
  const ids = projects.map((p) => p.id);

  const [rows, frozen] = await Promise.all([
    prisma.$queryRaw<Row[]>`
      SELECT project_id::text, date_trunc('month', entry_date)::date AS month, oos_status, SUM(minutes)::int AS minutes
      FROM time_entries
      WHERE project_id = ANY(${ids}::uuid[])
      GROUP BY 1, 2, 3`,
    prisma.retainerPeriod.findMany({ where: { projectId: { in: ids } } }),
  ]);

  const byProjectMonth = new Map<string, Map<IsoDate, OosMinutes>>();
  for (const r of rows) {
    const months = byProjectMonth.get(r.project_id) ?? new Map<IsoDate, OosMinutes>();
    const key = isoDate(r.month);
    const m = months.get(key) ?? empty();
    add(m, r.oos_status, r.minutes);
    months.set(key, m);
    byProjectMonth.set(r.project_id, months);
  }

  const frozenBy = new Map<string, Map<IsoDate, RetainerSettings>>();
  for (const f of frozen) {
    const m = frozenBy.get(f.projectId) ?? new Map<IsoDate, RetainerSettings>();
    m.set(isoDate(f.month), { hoursPerMonth: numOr0(f.hoursPerMonth), rolloverMode: f.rolloverMode, capHours: num(f.rolloverCapHours) });
    frozenBy.set(f.projectId, m);
  }

  for (const p of projects) {
    const thresholds = normalizeThresholds(p.budget?.alertThresholds ?? [75, 100]);
    const months = byProjectMonth.get(p.id) ?? new Map<IsoDate, OosMinutes>();

    if (p.contractType === "retainer" && p.budget?.retainerHoursPerMonth) {
      const currentSettings: RetainerSettings = {
        hoursPerMonth: numOr0(p.budget.retainerHoursPerMonth),
        rolloverMode: p.budget.rolloverMode,
        capHours: num(p.budget.rolloverCapHours),
      };
      const start = monthStart(isoDate(p.startDate));
      const end = monthStart(today) < start ? start : monthStart(today);
      const list = retainerMonths(
        monthsBetween(start, end).map((month) => ({
          month,
          settings: frozenBy.get(p.id)?.get(month) ?? currentSettings,
          minutes: months.get(month) ?? empty(),
        })),
        thresholds,
      );
      const current = list[list.length - 1]!;
      out.set(p.id, { mode: "retainer", periodStart: current.month, current, thresholds, months: list });
      continue;
    }

    const total = empty();
    for (const m of months.values()) {
      total.inScope += m.inScope;
      total.pending += m.pending;
      total.approved += m.approved;
    }
    out.set(p.id, {
      mode: "total",
      periodStart: isoDate(p.startDate),
      current: snapshot(num(p.budget?.budgetHours) ?? null, total, thresholds),
      thresholds,
      months: [],
    });
  }
  return out;
}

/**
 * Freezes the retainer settings of every past month that has no row yet, so
 * a settings change (or the monthly job) never rewrites history (M1.3).
 */
export async function freezeRetainerMonths(projectId: string, today: IsoDate = todayIn()): Promise<number> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { contractType: true, startDate: true, budget: true },
  });
  const b = project?.budget;
  if (!project || project.contractType !== "retainer" || !b?.retainerHoursPerMonth) return 0;

  const start = monthStart(isoDate(project.startDate));
  const past = monthsBetween(start, monthStart(today)).slice(0, -1); // not the current month
  if (past.length === 0) return 0;
  const res = await prisma.retainerPeriod.createMany({
    data: past.map((m) => ({
      projectId,
      month: new Date(`${m}T00:00:00Z`),
      hoursPerMonth: b.retainerHoursPerMonth!,
      rolloverMode: b.rolloverMode,
      rolloverCapHours: b.rolloverCapHours,
    })),
    skipDuplicates: true,
  });
  return res.count;
}

export type Breakdown = { id: string | null; name: string; minutes: number }[];

/**
 * In-scope hours of the current period by section and by person (M4.1 —
 * shown to the project's PM and C-Level only; callers check that).
 */
export async function healthBreakdown(projectId: string, periodStart: IsoDate, periodEnd?: IsoDate) {
  // Compare as dates: a JS Date parameter would be a timestamptz and shift
  // with the session time zone.
  const range = Prisma.sql`e.entry_date >= ${periodStart}::date${periodEnd ? Prisma.sql` AND e.entry_date <= ${periodEnd}::date` : Prisma.empty}`;
  const [bySection, byPerson] = await Promise.all([
    prisma.$queryRaw<{ id: string | null; name: string; minutes: number }[]>`
      SELECT s.id::text AS id, s.name || CASE WHEN s.archived_at IS NOT NULL THEN ' (archived)' ELSE '' END AS name, SUM(e.minutes)::int AS minutes
      FROM time_entries e JOIN tasks t ON t.id = e.task_id JOIN sections s ON s.id = t.section_id
      WHERE e.project_id = ${projectId}::uuid AND e.oos_status IN ('none', 'rejected') AND ${range}
      GROUP BY s.id, s.name, s.archived_at ORDER BY minutes DESC`,
    prisma.$queryRaw<{ id: string | null; name: string; minutes: number }[]>`
      SELECT p.id::text AS id, p.full_name AS name, SUM(e.minutes)::int AS minutes
      FROM time_entries e JOIN profiles p ON p.id = e.user_id
      WHERE e.project_id = ${projectId}::uuid AND e.oos_status IN ('none', 'rejected') AND ${range}
      GROUP BY p.id, p.full_name ORDER BY minutes DESC`,
  ]);
  return { bySection: bySection as Breakdown, byPerson: byPerson as Breakdown };
}

/** Last day of the retainer month that starts at `month`. */
export function monthEnd(month: IsoDate): IsoDate {
  return addDays(addMonths(month, 1), -1);
}
