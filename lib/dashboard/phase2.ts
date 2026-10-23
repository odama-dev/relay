import "server-only";
import { asUser, type CurrentUser } from "@/lib/auth";
import { hasModule } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { addDays, isoDate, monthStart, parseIsoDate, todayIn, weekStart, type IsoDate } from "@/lib/time/pure";
import { capacityHours, workloadFromOverdue, workloadPct } from "@/lib/metrics/pure";
import { capacityInputs, holidaySet } from "@/lib/metrics/queries";
import { computeKpi, kpiContext, metricActual } from "@/lib/kpi/engine";
import { normalize } from "@/lib/kpi/pure";
import { loadOkr } from "@/lib/kpi/okr";
import { loadPipeline } from "@/lib/sales/queries";
import { loadAgingByClient, loadObligations } from "@/lib/finance/ops";
import { numOr0 } from "@/lib/money";

/**
 * Phase 2 dashboards by responsibility (PRD "Revisi dashboard"): which
 * widgets someone gets follows what they do — owning tasks, reviewing,
 * managing people, owning OKRs, holding modules — not their role.
 */
export type WidgetContext = {
  hasTasks: boolean;
  isReviewer: boolean;
  hasReports: boolean;
  runsProjects: boolean;
  hasOkr: boolean;
  hasKpi: boolean;
  modules: { people: boolean; finance: boolean; sales: boolean; studioReport: boolean };
};

export async function widgetContext(user: CurrentUser): Promise<WidgetContext> {
  const today = todayIn(user.timezone);
  const [tasks, reviews, reports, projects, okr, kpi] = await asUser(user, (tx) =>
    Promise.all([
      tx.task.count({ where: { ownerId: user.id, status: { not: "done" } } }),
      tx.task.count({ where: { reviewerId: user.id, status: "review" } }),
      tx.profile.count({ where: { managerId: user.id, status: "active" } }),
      tx.project.count({ where: { pmId: user.id, status: { in: ["active", "on_hold"] } } }),
      tx.objectiveOwner.count({ where: { userId: user.id, objective: { status: { not: "archived" }, cycle: { status: "active" } } } }),
      tx.kpiAssignment.count({
        where: {
          startsOn: { lte: parseIsoDate(today) },
          OR: [{ userId: user.id }, { jobRole: { people: { some: { id: user.id } } } }],
          AND: [{ OR: [{ endsOn: null }, { endsOn: { gte: parseIsoDate(today) } }] }],
        },
      }),
    ]),
  );
  return {
    hasTasks: tasks > 0,
    isReviewer: reviews > 0,
    hasReports: reports > 0,
    runsProjects: projects > 0,
    hasOkr: okr > 0,
    hasKpi: kpi > 0,
    modules: {
      people: hasModule(user, "people"),
      finance: hasModule(user, "finance"),
      sales: hasModule(user, "sales"),
      studioReport: hasModule(user, "studio_report"),
    },
  };
}

// ---------------------------------------------------------------------------
// Review queue with SLA countdown
// ---------------------------------------------------------------------------

export type ReviewItem = { taskId: string; title: string; projectCode: string; owner: string | null; submittedAt: Date; slaDueAt: Date; hoursLeft: number };

/** Tasks waiting for your review, the one closest to (or past) its SLA first. */
export async function loadReviewQueue(user: CurrentUser): Promise<ReviewItem[]> {
  const rows = await asUser(user, (tx) =>
    tx.reviewRound.findMany({
      where: { decidedAt: null, reviewerId: user.id, task: { status: "review" } },
      include: { task: { select: { id: true, title: true, project: { select: { code: true } }, owner: { select: { fullName: true } } } } },
      orderBy: { slaDueAt: "asc" },
    }),
  );
  const now = Date.now();
  return rows.map((r) => ({
    taskId: r.task.id,
    title: r.task.title,
    projectCode: r.task.project.code,
    owner: r.task.owner?.fullName ?? null,
    submittedAt: r.submittedAt,
    slaDueAt: r.slaDueAt,
    hoursLeft: Math.round((r.slaDueAt.getTime() - now) / 36e5),
  }));
}

// ---------------------------------------------------------------------------
// Leave vs tasks (PRD "Cuti & kapasitas")
// ---------------------------------------------------------------------------

export type LeaveConflict = {
  taskId: string;
  title: string;
  projectId: string;
  projectCode: string;
  dueDate: IsoDate;
  owner: { id: string; name: string };
  leave: { start: IsoDate; end: IsoDate; kind: string };
  members: { id: string; name: string }[];
};

/**
 * Open tasks on the projects you run that fall due while their owner is on
 * approved leave (next 30 days). You decide: reassign, or move the due date.
 */
export async function loadLeaveConflicts(user: CurrentUser): Promise<LeaveConflict[]> {
  const today = todayIn(user.timezone);
  const until = addDays(today, 30);
  return asUser(user, async (tx) => {
    const tasks = await tx.task.findMany({
      where: {
        project: { pmId: user.id, status: { in: ["active", "on_hold"] } },
        status: { not: "done" },
        ownerId: { not: null },
        dueDate: { gte: parseIsoDate(today), lte: parseIsoDate(until) },
        section: { archivedAt: null },
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        projectId: true,
        owner: { select: { id: true, fullName: true } },
        project: { select: { code: true, members: { select: { user: { select: { id: true, fullName: true, status: true } } } } } },
      },
    });
    if (!tasks.length) return [];
    const leave = await tx.capacityOverride.findMany({
      where: { kind: { not: null }, userId: { in: [...new Set(tasks.map((t) => t.owner!.id))] }, periodEnd: { gte: parseIsoDate(today) }, periodStart: { lte: parseIsoDate(until) } },
      select: { userId: true, periodStart: true, periodEnd: true, kind: true },
    });
    const out: LeaveConflict[] = [];
    for (const t of tasks) {
      const due = isoDate(t.dueDate!);
      const l = leave.find((x) => x.userId === t.owner!.id && isoDate(x.periodStart) <= due && isoDate(x.periodEnd) >= due);
      if (!l) continue;
      out.push({
        taskId: t.id,
        title: t.title,
        projectId: t.projectId,
        projectCode: t.project.code,
        dueDate: due,
        owner: { id: t.owner!.id, name: t.owner!.fullName },
        leave: { start: isoDate(l.periodStart), end: isoDate(l.periodEnd), kind: l.kind! },
        members: t.project.members.filter((m) => m.user.status === "active" && m.user.id !== t.owner!.id).map((m) => ({ id: m.user.id, name: m.user.fullName })),
      });
    }
    return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  });
}

/** Approved leave of these people from today on — for the New task warning. */
export async function upcomingLeave(user: CurrentUser, userIds: string[]) {
  const today = todayIn(user.timezone);
  const rows = await asUser(user, (tx) =>
    tx.capacityOverride.findMany({
      where: { kind: { not: null }, userId: { in: userIds }, periodEnd: { gte: parseIsoDate(today) } },
      select: { userId: true, periodStart: true, periodEnd: true },
    }),
  );
  return rows.map((r) => ({ userId: r.userId, start: isoDate(r.periodStart), end: isoDate(r.periodEnd) }));
}

// ---------------------------------------------------------------------------
// Team workload (managers)
// ---------------------------------------------------------------------------

export type TeamWorkloadRow = { id: string; name: string; plannedHours: number; capacityHours: number; pct: number | null; fromOverdue: boolean; away: boolean };

/**
 * Workload this week for the people reporting to you — not utilization.
 * The reporting line is proven under RLS (app.is_manager_of); their tasks
 * are then read on the system connection, since a manager isn't always on
 * their reports' projects.
 */
export async function loadTeamWorkload(user: CurrentUser): Promise<TeamWorkloadRow[]> {
  const today = todayIn(user.timezone);
  const ws = weekStart(today);
  const we = addDays(ws, 6);
  const { reports, cap, holidays } = await asUser(user, async (tx) => {
    const reports = await tx.$queryRaw<{ id: string; name: string }[]>`
      SELECT p.id::text, p.full_name AS name FROM public.profiles p WHERE p.status = 'active' AND p.id <> app.uid() AND app.is_manager_of(p.id) ORDER BY p.full_name`;
    return { reports, cap: await capacityInputs(tx, reports.map((r) => r.id), we, ws), holidays: await holidaySet(tx, ws, we) };
  });
  if (!reports.length) return [];
  const settings = await getSettings();
  const tasks = await prisma.task.findMany({
    where: { ownerId: { in: reports.map((r) => r.id) }, status: { not: "done" }, dueDate: { lte: parseIsoDate(we) }, section: { archivedAt: null } },
    select: { ownerId: true, dueDate: true, estimateHours: true },
  });
  return reports
    .map((r) => {
      const mine = tasks.filter((t) => t.ownerId === r.id);
      const planned = Math.round(mine.reduce((s, t) => s + Number(t.estimateHours ?? 0), 0) * 10) / 10;
      const overdue = mine.filter((t) => isoDate(t.dueDate!) < today).reduce((s, t) => s + Number(t.estimateHours ?? 0), 0);
      const overrides = cap.overridesOf(r.id);
      const capacity = capacityHours(cap.capacityOf(r.id), overrides, { start: ws, end: we }, settings.workdays, holidays);
      return {
        id: r.id,
        name: r.name,
        plannedHours: planned,
        capacityHours: capacity,
        pct: workloadPct(planned, capacity),
        fromOverdue: workloadFromOverdue(overdue, planned),
        away: overrides.some((o) => o.kind && o.start <= today && o.end >= today),
      };
    })
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
}

// ---------------------------------------------------------------------------
// KPI and OKR
// ---------------------------------------------------------------------------

/** Your KPI so far this month, and Task on Time per week with Achieve / Not achieved (Designer preset). */
export async function loadMyKpiCard(user: CurrentUser) {
  const today = todayIn(user.timezone);
  const ctx = await kpiContext();
  const kpi = await computeKpi(user.id, "monthly", today, ctx);
  const onTime = ctx.metrics.get("task_on_time");
  const item = kpi.items.find((i) => i.metricKey === "task_on_time");
  const target = item?.target ?? 90;
  const weeks: { start: IsoDate; actual: number | null; achieved: boolean | null }[] = [];
  if (onTime) {
    for (let i = 3; i >= 0; i--) {
      const start = addDays(weekStart(today), -7 * i);
      const actual = await metricActual(onTime, user.id, { start, end: addDays(start, 6) }, ctx);
      weeks.push({ start, actual, achieved: actual === null ? null : (normalize(actual, target, "higher") ?? 0) >= 100 });
    }
  }
  return { kpi, weeks, target };
}

export async function loadMyOkr(user: CurrentUser) {
  const data = await loadOkr(user, undefined, todayIn(user.timezone));
  return { cycle: data.cycle, objectives: data.objectives.filter((o) => o.isOwner && !o.isStudio) };
}

export async function loadStudioOkr(user: CurrentUser) {
  const data = await loadOkr(user, undefined, todayIn(user.timezone));
  return { cycle: data.cycle, objectives: data.objectives.filter((o) => o.isStudio) };
}

// ---------------------------------------------------------------------------
// Sales and Finance modules (Phase 2 · M9)
// ---------------------------------------------------------------------------

/** Sales module: the pipeline's top figures and the open deals that need a nudge. */
export async function loadPipelineWidget(user: CurrentUser) {
  const data = await loadPipeline(user, { closed: "recent" });
  const open = data.deals.filter((d) => d.category === "open");
  const attention = open
    .filter((d) => d.stale || (d.expectedClose !== null && d.expectedClose <= addDays(data.today, 14)))
    .sort((a, b) => Number(b.stale) - Number(a.stale) || (a.expectedClose ?? "9").localeCompare(b.expectedClose ?? "9"));
  return { cards: data.cards, attention, today: data.today };
}

/** Finance module: payment proofs from Sales waiting to be verified, oldest first. */
export async function loadProofQueue(user: CurrentUser) {
  const rows = await asUser(user, (tx) =>
    tx.paymentProof.findMany({
      where: { status: "submitted" },
      orderBy: { submittedAt: "asc" },
      include: { invoice: { select: { id: true, number: true, billToName: true } } },
    }),
  );
  return rows.map((p) => ({
    id: p.id,
    invoiceId: p.invoice.id,
    number: p.invoice.number,
    client: p.invoice.billToName,
    amount: numOr0(p.amount),
    currency: p.currency,
    submittedOn: todayIn(user.timezone, p.submittedAt),
    own: p.submittedBy === user.id,
  }));
}

/** Finance module: the clients with the most overdue, in IDR. */
export async function loadAgingWidget(user: CurrentUser) {
  const rows = await loadAgingByClient(user);
  return rows.filter((r) => r.total - r.buckets.not_due > 0);
}

/** Finance / People modules: obligations not done in the next 14 days (and any past due this month). */
export async function loadUpcomingObligations(user: CurrentUser) {
  const today = todayIn(user.timezone);
  const items = await loadObligations(user, monthStart(today), addDays(today, 14));
  return { today, items: items.filter((it) => it.kind !== "invoice" && !it.done) };
}
