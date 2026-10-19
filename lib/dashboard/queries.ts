import "server-only";
import type { InvoiceStatus, PaymentRequestStatus, ProjectStatus, Prisma, TaskPriority, TaskStatus, UserRole, EmploymentType } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { num, numOr0 } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { formatMoney } from "@/lib/format";
import { computeHealth } from "@/lib/health/queries";
import { riskScore, type HealthStatus } from "@/lib/health/pure";
import { getMyTasks } from "@/lib/tasks/queries";
import { getCompliance } from "@/lib/time/compliance";
import { addDays, addMonths, isoDate, isoWeekday, monthStart, parseIsoDate, todayIn, weekDays, weekStart, type IsoDate } from "@/lib/time/pure";
import { daysLate, onTimeRate, requestDueState, sumByCurrency, taskRisk, type DueState, type Money, type RiskKind } from "@/lib/dashboard/pure";

/**
 * Data for the dashboard cards (PRD/OVERVIEW-SPEC.md). One loader per card,
 * every user-facing read under RLS (`asUser`). The only system reads are the
 * shared health math (`computeHealth`, after the budgets were read under RLS —
 * same as Project Health) and nothing else.
 */

export type DashboardContext = {
  user: CurrentUser;
  today: IsoDate;
  weekStart: IsoDate;
  weekEnd: IsoDate;
  monthStart: IsoDate;
  monthEnd: IsoDate;
};

export function dashboardContext(user: CurrentUser): DashboardContext {
  const today = todayIn(user.timezone);
  const ws = weekStart(today);
  const ms = monthStart(today);
  return { user, today, weekStart: ws, weekEnd: addDays(ws, 6), monthStart: ms, monthEnd: addDays(addMonths(ms, 1), -1) };
}

/** Local calendar day of a timestamp in the viewer's zone. */
const localDay = (ctx: DashboardContext, at: Date) => todayIn(ctx.user.timezone, at);
/** A safe UTC lower bound for "since local day `d`" (filtered exactly with localDay afterwards). */
const since = (d: IsoDate) => parseIsoDate(addDays(d, -1));

const OPEN_INVOICE: InvoiceStatus[] = ["sent", "partially_paid", "overdue"];
const ACTIVE: ProjectStatus[] = ["active", "on_hold"];

// ---------------------------------------------------------------------------
// Designer & Developer
// ---------------------------------------------------------------------------

export type DueTask = {
  id: string;
  title: string;
  projectCode: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: IsoDate;
  overdue: boolean;
};

/** DD-1 — open tasks you own or collaborate on that are overdue or due today. */
export async function loadDueTasks(ctx: DashboardContext) {
  const tasks = await getMyTasks(ctx.user);
  const due = tasks
    .filter((t) => t.dueDate && t.dueDate <= ctx.today)
    .map(
      (t): DueTask => ({
        id: t.id,
        title: t.title,
        projectCode: t.projectCode,
        priority: t.priority,
        status: t.status,
        dueDate: t.dueDate!,
        overdue: t.dueDate! < ctx.today,
      }),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return { overdue: due.filter((t) => t.overdue), today: due.filter((t) => !t.overdue), total: due.length };
}

export type WeekDay = { date: IsoDate; minutes: number; workday: boolean; missing: boolean; isToday: boolean };

/** DD-2 — your logged hours per day this week; past workdays without time are flagged (today isn't over yet). */
export async function loadWeekHours(ctx: DashboardContext) {
  const [settings, rows] = await Promise.all([
    getSettings(),
    asUser(ctx.user, (tx) =>
      tx.timeEntry.groupBy({
        by: ["entryDate"],
        where: { userId: ctx.user.id, entryDate: { gte: parseIsoDate(ctx.weekStart), lte: parseIsoDate(ctx.weekEnd) } },
        _sum: { minutes: true },
      }),
    ),
  ]);
  const byDay = new Map(rows.map((r) => [isoDate(r.entryDate), r._sum.minutes ?? 0]));
  const days: WeekDay[] = weekDays(ctx.weekStart).map((date) => {
    const minutes = byDay.get(date) ?? 0;
    const workday = settings.workdays.includes(isoWeekday(date));
    return { date, minutes, workday, missing: workday && minutes === 0 && date < ctx.today, isToday: date === ctx.today };
  });
  return { weekStart: ctx.weekStart, days, total: days.reduce((s, d) => s + d.minutes, 0) };
}

export type RecentComment = { id: string; author: { id: string; name: string; avatarUrl: string | null }; text: string; createdAt: Date; task: { id: string; title: string }; mentioned: boolean };

/** DD-3 — comments of the last 7 days on your tasks, or mentioning you; not your own, not deleted. */
export async function loadRecentComments(ctx: DashboardContext): Promise<RecentComment[]> {
  const uid = ctx.user.id;
  const rows = await asUser(ctx.user, (tx) =>
    tx.taskComment.findMany({
      where: {
        deletedAt: null,
        authorId: { not: uid },
        createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
        OR: [
          { task: { ownerId: uid } },
          { task: { collaborators: { some: { userId: uid } } } },
          { body: { path: ["mentions"], array_contains: [uid] } },
        ],
      },
      include: { author: { select: { id: true, fullName: true, avatarUrl: true } }, task: { select: { id: true, title: true } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  );
  return rows.map((c) => {
    const body = c.body as { text?: string; mentions?: string[] };
    return {
      id: c.id,
      author: { id: c.author.id, name: c.author.fullName, avatarUrl: c.author.avatarUrl },
      text: String(body?.text ?? "").replace(/\s+/g, " ").trim(),
      createdAt: c.createdAt,
      task: c.task,
      mentioned: Array.isArray(body?.mentions) && body.mentions.includes(uid),
    };
  });
}

/** DD-4 — tasks you own: completed this month, on-time rate, overdue now. */
export async function loadMonthSummary(ctx: DashboardContext) {
  const tasks = await asUser(ctx.user, (tx) =>
    tx.task.findMany({
      where: {
        ownerId: ctx.user.id,
        section: { archivedAt: null },
        OR: [
          { completedAt: { gte: since(ctx.monthStart) } },
          { status: { not: "done" }, dueDate: { lt: parseIsoDate(ctx.today) } },
        ],
      },
      select: { status: true, dueDate: true, completedAt: true },
    }),
  );
  const done = tasks
    .filter((t) => t.status === "done" && t.completedAt)
    .map((t) => ({ dueDate: t.dueDate ? isoDate(t.dueDate) : null, completedOn: localDay(ctx, t.completedAt!) }))
    .filter((t) => t.completedOn >= ctx.monthStart && t.completedOn <= ctx.monthEnd);
  const overdue = tasks.filter((t) => t.status !== "done" && t.dueDate && isoDate(t.dueDate) < ctx.today).length;
  return { completed: done.length, onTimePct: onTimeRate(done), overdue };
}

// ---------------------------------------------------------------------------
// Project health (PM-2, SL-3)
// ---------------------------------------------------------------------------

export type HealthRow = {
  id: string;
  code: string;
  name: string;
  client: string;
  clientId: string | null;
  pm: string;
  status: HealthStatus;
  pct: number | null;
  usedHours: number;
  budgetHours: number | null;
  pendingOosHours: number;
  overdueTasks: number;
  risk: number;
};

async function healthRows(ctx: DashboardContext, where: Prisma.ProjectWhereInput): Promise<HealthRow[]> {
  const { projects, overdue } = await asUser(ctx.user, async (tx) => {
    const projects = await tx.project.findMany({
      where,
      include: { budget: true, client: { select: { name: true } }, pm: { select: { fullName: true } } },
    });
    // Overdue tasks the viewer may see (PM: their projects; C-Level: all). Sales sees none here.
    const overdue = await tx.task.groupBy({
      by: ["projectId"],
      where: { projectId: { in: projects.map((p) => p.id) }, status: { not: "done" }, dueDate: { lt: parseIsoDate(ctx.today) }, section: { archivedAt: null } },
      _count: true,
    });
    return { projects, overdue };
  });
  // Budgets came back under RLS, so the viewer may see this project's health.
  const health = await computeHealth(projects.filter((p) => p.budget), ctx.today);
  const overdueBy = new Map(overdue.map((o) => [o.projectId, o._count]));
  return projects
    .map((p) => {
      const h = health.get(p.id)?.current;
      const row = {
        id: p.id,
        code: p.code,
        name: p.name,
        client: p.client?.name ?? "Internal",
        clientId: p.clientId,
        pm: p.pm.fullName,
        status: h?.status ?? ("no_budget" as const),
        pct: h?.pct ?? null,
        usedHours: h?.usedHours ?? 0,
        budgetHours: h?.budgetHours ?? null,
        pendingOosHours: h?.pendingOosHours ?? 0,
        overdueTasks: overdueBy.get(p.id) ?? 0,
      };
      return { ...row, risk: riskScore({ ...row, pendingOos: row.pendingOosHours }) };
    })
    .sort((a, b) => b.risk - a.risk);
}

/** PM-2 — active / on-hold projects you run, most at risk first. */
export function loadMyProjectHealth(ctx: DashboardContext) {
  return healthRows(ctx, { pmId: ctx.user.id, status: { in: ACTIVE } });
}

// ---------------------------------------------------------------------------
// Tasks at risk (PM-3)
// ---------------------------------------------------------------------------

export type RiskTask = {
  id: string;
  title: string;
  projectId: string;
  projectCode: string;
  status: TaskStatus;
  dueDate: IsoDate | null;
  owner: string | null;
  risk: RiskKind;
};

/** PM-3 — overdue, blocked or ownerless tasks on the projects you run; members to assign from. */
export async function loadTasksAtRisk(ctx: DashboardContext) {
  const { tasks, members } = await asUser(ctx.user, async (tx) => {
    const tasks = await tx.task.findMany({
      where: {
        project: { pmId: ctx.user.id, status: { in: ACTIVE } },
        section: { archivedAt: null },
        status: { not: "done" },
        OR: [{ dueDate: { lt: parseIsoDate(ctx.today) } }, { status: "blocked" }, { ownerId: null }],
      },
      include: { project: { select: { code: true } }, owner: { select: { fullName: true } } },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    });
    const projectIds = [...new Set(tasks.filter((t) => !t.ownerId).map((t) => t.projectId))];
    const members = projectIds.length
      ? await tx.projectMember.findMany({
          where: { projectId: { in: projectIds }, user: { status: "active" } },
          select: { projectId: true, user: { select: { id: true, fullName: true } } },
          orderBy: { user: { fullName: "asc" } },
        })
      : [];
    return { tasks, members };
  });
  const rows: RiskTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    projectId: t.projectId,
    projectCode: t.project.code,
    status: t.status,
    dueDate: t.dueDate ? isoDate(t.dueDate) : null,
    owner: t.owner?.fullName ?? null,
    risk: taskRisk({ dueDate: t.dueDate ? isoDate(t.dueDate) : null, status: t.status, ownerId: t.ownerId }, ctx.today)!,
  }));
  const membersBy: Record<string, { id: string; name: string }[]> = {};
  for (const m of members) (membersBy[m.projectId] ??= []).push({ id: m.user.id, name: m.user.fullName });
  const count = (k: RiskKind) => rows.filter((r) => r.risk === k).length;
  return { rows, counts: { overdue: count("overdue"), blocked: count("blocked"), no_owner: count("no_owner") }, membersBy };
}

// ---------------------------------------------------------------------------
// Payment requests (PM-4, FN-3, FN-4, SL-3)
// ---------------------------------------------------------------------------

export type OpenRequest = {
  id: string;
  label: string;
  amount: number;
  currency: string;
  dueDate: IsoDate;
  state: DueState | null;
  daysLate: number;
  invoice: { id: string; number: string | null; createdBy: string | null };
  client: { id: string; name: string };
};

async function openRequests(ctx: DashboardContext, invoice: Prisma.InvoiceWhereInput = {}): Promise<OpenRequest[]> {
  const rows = await asUser(ctx.user, (tx) =>
    tx.invoicePaymentRequest.findMany({
      where: { status: "pending", invoice: { status: { in: OPEN_INVOICE }, ...invoice } },
      include: {
        invoice: { select: { id: true, number: true, currency: true, client: { select: { id: true, name: true } }, creator: { select: { fullName: true } } } },
      },
      orderBy: { dueDate: "asc" },
    }),
  );
  return rows.map((r) => {
    const due = isoDate(r.dueDate);
    return {
      id: r.id,
      label: r.label,
      amount: numOr0(r.amount),
      currency: r.invoice.currency,
      dueDate: due,
      state: requestDueState(due, ctx.today),
      daysLate: daysLate(due, ctx.today),
      invoice: { id: r.invoice.id, number: r.invoice.number, createdBy: r.invoice.creator?.fullName ?? null },
      client: r.invoice.client,
    };
  });
}

/** PM-4 — pending requests on your projects' invoices that are due within 7 days or late. */
export async function loadProjectBilling(ctx: DashboardContext) {
  return (await openRequests(ctx, { project: { pmId: ctx.user.id } })).filter((r) => r.state);
}

/** FN-3 — due soon and late requests across every project. */
export async function loadDueAndLate(ctx: DashboardContext) {
  const rows = (await openRequests(ctx)).filter((r) => r.state);
  const late = rows.filter((r) => r.state === "late").sort((a, b) => b.daysLate - a.daysLate);
  const soon = rows.filter((r) => r.state === "due_soon");
  return { late, soon, lateTotals: sumByCurrency(late), soonTotals: sumByCurrency(soon) };
}

/** FN-4 — what each client still owes, per currency. */
export async function loadOutstandingByClient(ctx: DashboardContext) {
  const rows = await openRequests(ctx);
  const byClient = new Map<string, { id: string; name: string; items: Money[]; late: number }>();
  for (const r of rows) {
    const c = byClient.get(r.client.id) ?? { id: r.client.id, name: r.client.name, items: [], late: 0 };
    c.items.push({ currency: r.currency, amount: r.amount });
    if (r.state === "late") c.late += 1;
    byClient.set(r.client.id, c);
  }
  // Currencies are never converted (§1.4): rank by the IDR amount, then by the largest other amount.
  const rank = (m: Money[]) => [m.find((x) => x.currency === "IDR")?.amount ?? 0, Math.max(0, ...m.filter((x) => x.currency !== "IDR").map((x) => x.amount))] as const;
  return [...byClient.values()]
    .map((c) => ({ id: c.id, name: c.name, outstanding: sumByCurrency(c.items), late: c.late }))
    .sort((a, b) => {
      const [ai, ao] = rank(a.outstanding);
      const [bi, bo] = rank(b.outstanding);
      return bi - ai || bo - ao || a.name.localeCompare(b.name);
    });
}

// ---------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------

/**
 * HR-1 — who left a past workday of this week empty. Today doesn't count
 * yet (§2 HR-1: workdays that have passed); the compliance page still shows it.
 */
export async function loadComplianceSummary(ctx: DashboardContext) {
  const data = await getCompliance(ctx.user, ctx.today, ctx.today);
  const rows = data.rows.map((r) => ({ id: r.id, name: r.name, role: r.role, missing: r.days.filter((d) => d.missing && d.date < ctx.today).map((d) => d.date) }));
  const incomplete = rows.filter((r) => r.missing.length > 0).sort((a, b) => b.missing.length - a.missing.length || a.name.localeCompare(b.name));
  return { weekStart: data.weekStart, people: rows.length, complete: rows.length - incomplete.length, incomplete };
}

export type PersonTasks = { id: string; name: string; role: UserRole; open: number; overdue: number; done: number };

/** HR-3 — open, overdue and done-this-month tasks per active person (counts only — see the dashboard migration). */
export async function loadTasksPerPerson(ctx: DashboardContext): Promise<PersonTasks[]> {
  const { counts, people } = await asUser(ctx.user, async (tx) => ({
    counts: await tx.$queryRaw<{ user_id: string; open_tasks: number; overdue_tasks: number; done_this_month: number }[]>`
      SELECT user_id::text, open_tasks, overdue_tasks, done_this_month
      FROM app.task_summary_per_person(${ctx.today}::date, ${ctx.monthStart}::date, ${ctx.monthEnd}::date)`,
    people: await tx.profile.findMany({ where: { status: "active" }, select: { id: true, fullName: true, role: true } }),
  }));
  const byId = new Map(counts.map((c) => [c.user_id, c]));
  return people
    .filter((p) => byId.has(p.id))
    .map((p) => {
      const c = byId.get(p.id)!;
      return { id: p.id, name: p.fullName, role: p.role, open: c.open_tasks, overdue: c.overdue_tasks, done: c.done_this_month };
    })
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name));
}

/** HR-4 — active people by employment type and role; invitations not yet accepted. */
export async function loadTeamComposition(ctx: DashboardContext) {
  const { byType, byRole, invited } = await asUser(ctx.user, async (tx) => ({
    byType: await tx.profile.groupBy({ by: ["employmentType"], where: { status: "active" }, _count: true }),
    byRole: await tx.profile.groupBy({ by: ["role"], where: { status: "active" }, _count: true }),
    invited: await tx.profile.findMany({ where: { status: "invited" }, select: { id: true, fullName: true, email: true, role: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
  }));
  return {
    total: byType.reduce((s, r) => s + r._count, 0),
    byType: byType.map((r) => ({ type: r.employmentType as EmploymentType, count: r._count })).sort((a, b) => b.count - a.count),
    byRole: byRole.map((r) => ({ role: r.role, count: r._count })).sort((a, b) => b.count - a.count),
    invited: invited.map((p) => ({ id: p.id, name: p.fullName, email: p.email, role: p.role, invitedAt: p.createdAt })),
  };
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

/** FN-1 — payments without an invoice, and matched ones flagged for review; open requests to match against. */
export async function loadUnmatchedPayments(ctx: DashboardContext) {
  const { payments, requests } = await asUser(ctx.user, async (tx) => ({
    payments: await tx.payment.findMany({
      where: { OR: [{ invoiceId: null }, { needsReview: true }] },
      orderBy: { paidAt: "desc" },
      select: { id: true, externalId: true, amount: true, currency: true, settlementAmountIdr: true, paidAt: true, channel: true, invoiceId: true, needsReview: true },
    }),
    requests: await tx.invoicePaymentRequest.findMany({
      where: { status: { in: ["pending", "expired"] }, invoice: { status: { notIn: ["draft", "void"] } } },
      include: { invoice: { select: { number: true, billToName: true, currency: true } } },
      orderBy: { dueDate: "asc" },
    }),
  }));
  return {
    rows: payments.map((p) => ({
      id: p.id,
      externalId: p.externalId,
      amount: numOr0(p.amount),
      currency: p.currency,
      idr: num(p.settlementAmountIdr),
      paidAt: p.paidAt,
      channel: p.channel,
      unmatched: !p.invoiceId,
      needsReview: p.needsReview,
    })),
    // Same wording as Payments → Match.
    options: requests.map((r) => ({
      id: r.id,
      label: `${r.invoice.number ?? "Draft"} · ${r.label} · ${formatMoney(numOr0(r.amount), r.invoice.currency)} · ${r.invoice.billToName}`,
    })),
  };
}

/** FN-2 — matched payments received today and this week (IDR), the latest five. */
export async function loadIncomingPayments(ctx: DashboardContext) {
  const rows = await asUser(ctx.user, (tx) =>
    tx.payment.findMany({
      where: { invoiceId: { not: null }, paidAt: { gte: since(ctx.weekStart) } },
      include: { invoice: { select: { id: true, number: true, client: { select: { name: true } } } }, paymentRequest: { select: { label: true } } },
      orderBy: { paidAt: "desc" },
    }),
  );
  const week = rows.filter((p) => localDay(ctx, p.paidAt) >= ctx.weekStart);
  const today = week.filter((p) => localDay(ctx, p.paidAt) === ctx.today);
  const idr = (list: typeof rows) => sumByCurrency(list.map((p) => ({ currency: "IDR", amount: numOr0(p.settlementAmountIdr) })))[0]?.amount ?? 0;
  return {
    today: idr(today),
    todayCount: today.length,
    week: idr(week),
    weekCount: week.length,
    latest: week.slice(0, 5).map((p) => ({
      id: p.id,
      client: p.invoice?.client.name ?? "—",
      invoice: p.invoice ? { id: p.invoice.id, number: p.invoice.number } : null,
      label: p.paymentRequest?.label ?? null,
      amount: numOr0(p.amount),
      currency: p.currency,
      idr: num(p.settlementAmountIdr),
      fee: num(p.feeAmount),
      paidAt: p.paidAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// Sales & Marketing
// ---------------------------------------------------------------------------

/** SL-1 — your draft invoices; Send is offered when the bill-to email and payment requests are there. */
export async function loadDraftInvoices(ctx: DashboardContext) {
  const rows = await asUser(ctx.user, (tx) =>
    tx.invoice.findMany({
      where: { status: "draft", createdBy: ctx.user.id },
      include: { project: { select: { code: true, name: true } }, client: { select: { name: true } }, _count: { select: { paymentRequests: true, items: true } } },
      orderBy: { createdAt: "asc" },
    }),
  );
  return rows.map((i) => ({
    id: i.id,
    project: `${i.project.code} · ${i.project.name}`,
    client: i.client.name,
    total: numOr0(i.total),
    currency: i.currency,
    createdAt: i.createdAt,
    ready: Boolean(i.billToEmail) && i._count.items > 0 && i._count.paymentRequests > 0,
  }));
}

export type MyInvoice = {
  id: string;
  number: string | null;
  client: string;
  status: InvoiceStatus;
  currency: string;
  remaining: number;
  requests: { label: string; status: PaymentRequestStatus | "late"; dueDate: IsoDate }[];
};

/** SL-2 — invoices you created that are open, or became Paid in the last 30 days. Late first. */
export async function loadMyInvoices(ctx: DashboardContext): Promise<MyInvoice[]> {
  const cutoff = new Date(Date.now() - 30 * 86_400_000);
  const rows = await asUser(ctx.user, (tx) =>
    tx.invoice.findMany({
      where: {
        createdBy: ctx.user.id,
        OR: [{ status: { in: OPEN_INVOICE } }, { status: "paid", paymentRequests: { some: { paidAt: { gte: cutoff } } } }],
      },
      include: { client: { select: { name: true } }, paymentRequests: { orderBy: { position: "asc" }, select: { label: true, status: true, dueDate: true } } },
      orderBy: { issueDate: "desc" },
    }),
  );
  const order: Record<InvoiceStatus, number> = { overdue: 0, partially_paid: 1, sent: 2, paid: 3, draft: 4, void: 5 };
  return rows
    .map((i) => ({
      id: i.id,
      number: i.number,
      client: i.client.name,
      status: i.status,
      currency: i.currency,
      remaining: Math.max(0, numOr0(i.total) - numOr0(i.amountPaid)),
      requests: i.paymentRequests.map((r) => {
        const due = isoDate(r.dueDate);
        return { label: r.label, status: r.status === "pending" && due < ctx.today ? ("late" as const) : r.status, dueDate: due };
      }),
    }))
    .sort((a, b) => order[a.status] - order[b.status]);
}

/** SL-3 — clients with active / on-hold projects: project count, worst health, outstanding, late or not. */
export async function loadActiveClients(ctx: DashboardContext) {
  const [projects, requests] = await Promise.all([healthRows(ctx, { kind: "client", status: { in: ACTIVE } }), openRequests(ctx)]);
  const worst: HealthStatus[] = ["over_budget", "warning", "on_track", "no_budget"];
  const byClient = new Map<string, { id: string; name: string; projects: number; health: HealthStatus }>();
  for (const p of projects) {
    if (!p.clientId) continue;
    const c = byClient.get(p.clientId) ?? { id: p.clientId, name: p.client, projects: 0, health: "no_budget" as HealthStatus };
    c.projects += 1;
    if (worst.indexOf(p.status) < worst.indexOf(c.health)) c.health = p.status;
    byClient.set(p.clientId, c);
  }
  return [...byClient.values()]
    .map((c) => {
      const mine = requests.filter((r) => r.client.id === c.id);
      return { ...c, outstanding: sumByCurrency(mine), late: mine.some((r) => r.state === "late") };
    })
    .sort((a, b) => Number(b.late) - Number(a.late) || worst.indexOf(a.health) - worst.indexOf(b.health) || a.name.localeCompare(b.name));
}

/** SL-4 — active client projects with no invoice at all. */
export async function loadUninvoicedProjects(ctx: DashboardContext) {
  const rows = await asUser(ctx.user, (tx) =>
    tx.project.findMany({
      where: { kind: "client", status: "active", invoices: { none: {} } },
      include: { client: { select: { name: true } } },
      orderBy: { startDate: "asc" },
    }),
  );
  return rows.map((p) => ({ id: p.id, code: p.code, name: p.name, client: p.client?.name ?? "—", startDate: isoDate(p.startDate), contractType: p.contractType }));
}
