import "server-only";
import { cache } from "react";
import type { ClientPaymentStatus, HrEventColor, InvoiceStatus, LeaveKind, PaymentRequestStatus, ProjectKind, ProjectStatus, Prisma, TaskPriority, TaskStatus, UserRole } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { num, numOr0 } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { formatMoney } from "@/lib/format";
import { getIdrRates } from "@/lib/fx";
import { normalizeToIdr } from "@/lib/invoices/pure";
import { computeHealth } from "@/lib/health/queries";
import { riskScore, type HealthStatus } from "@/lib/health/pure";
import { getMyTasks } from "@/lib/tasks/queries";
import { sundayOf } from "@/lib/hr/pure";
import { billableMinutes as billableMinutesOf, capacityHours as capacityHours_, isBillableEntry } from "@/lib/metrics/pure";
import { capacityInputs, holidaySet } from "@/lib/metrics/queries";
import { onTimeInputs } from "@/lib/tasks/timing";
import { addDays, addMonths, isoDate, isoWeekday, monthStart, parseIsoDate, todayIn, weekDays, weekStart, type IsoDate } from "@/lib/time/pure";
import { DEFAULT_REPORT_RANGE, REPORT_RANGES, type ReportRange } from "@/lib/sales/pure";
import { clientPaymentState, daysLate, onTimeRate, PROJECT_STANDINGS, projectStanding, requestDueState, sumByCurrency, taskRisk, utilizationPct, type ClientPaymentState, type DueState, type Money, type ProjectStanding, type WorkPeriod } from "@/lib/dashboard/pure";

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

const OPEN_INVOICE: InvoiceStatus[] = ["sent", "partially_paid", "payment_submitted", "overdue"];
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
      take: 8,
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

export type TimelineProject = { id: string; code: string; name: string; kind: ProjectKind; startDate: IsoDate; endDate: IsoDate; openEnded: boolean; color: HrEventColor | null };
export type TimelineTask = { id: string; title: string; projectId: string; projectCode: string; dueDate: IsoDate; status: TaskStatus };

/**
 * DD-4 — the calendar of your work for the weeks shown (the month's, or one
 * Sunday-first week around `anchor`): active projects you're on (a member,
 * or owning / helping on one of their tasks) from start to end — an open end
 * runs to the grid's last day — your tasks due then, and the minutes you
 * logged each day.
 */
export async function loadProjectCalendar(ctx: DashboardContext, view: "month" | "week", anchor: IsoDate) {
  const uid = ctx.user.id;
  const month = monthStart(anchor);
  const weekStart = view === "week" ? sundayOf(anchor) : null;
  const from = weekStart ?? sundayOf(month);
  const to = weekStart ? addDays(weekStart, 6) : addDays(sundayOf(addDays(addMonths(month, 1), -1)), 6);
  const mine: Prisma.TaskWhereInput = { OR: [{ ownerId: uid }, { collaborators: { some: { userId: uid } } }] };
  const { projects, tasks, logged } = await asUser(ctx.user, async (tx) => ({
    projects: await tx.project.findMany({
      where: {
        status: { in: ACTIVE },
        startDate: { lte: parseIsoDate(to) },
        AND: [{ OR: [{ endDate: null }, { endDate: { gte: parseIsoDate(from) } }] }, { OR: [{ members: { some: { userId: uid } } }, { tasks: { some: mine } }] }],
      },
      select: { id: true, code: true, name: true, kind: true, startDate: true, endDate: true, calendarColor: true },
      orderBy: { startDate: "asc" },
    }),
    tasks: await tx.task.findMany({
      where: { ...mine, dueDate: { gte: parseIsoDate(from), lte: parseIsoDate(to) } },
      select: { id: true, title: true, status: true, dueDate: true, projectId: true, project: { select: { code: true } } },
      orderBy: [{ dueDate: "asc" }, { title: "asc" }],
    }),
    logged: await tx.timeEntry.groupBy({
      by: ["entryDate"],
      where: { userId: uid, entryDate: { gte: parseIsoDate(from), lte: parseIsoDate(to) } },
      _sum: { minutes: true },
    }),
  }));
  return {
    view,
    month,
    weekStart,
    minutesByDay: Object.fromEntries(logged.map((r) => [isoDate(r.entryDate), r._sum.minutes ?? 0])) as Record<IsoDate, number>,
    projects: projects.map(
      (p): TimelineProject => ({ id: p.id, code: p.code, name: p.name, kind: p.kind, startDate: isoDate(p.startDate), endDate: p.endDate ? isoDate(p.endDate) : to, openEnded: !p.endDate, color: p.calendarColor }),
    ),
    tasks: tasks.map((t): TimelineTask => ({ id: t.id, title: t.title, projectId: t.projectId, projectCode: t.project.code, dueDate: isoDate(t.dueDate!), status: t.status })),
  };
}

/** DD-5 — your logged minutes per day over the last `weeks` Monday-first weeks, this one included. */
export async function loadActivityHeatmap(ctx: DashboardContext, weeks: number) {
  const start = addDays(ctx.weekStart, -7 * (weeks - 1));
  const rows = await asUser(ctx.user, (tx) =>
    tx.timeEntry.groupBy({
      by: ["entryDate"],
      where: { userId: ctx.user.id, entryDate: { gte: parseIsoDate(start), lte: parseIsoDate(ctx.today) } },
      _sum: { minutes: true },
    }),
  );
  const byDay = new Map(rows.map((r) => [isoDate(r.entryDate), r._sum.minutes ?? 0]));
  return {
    start,
    today: ctx.today,
    weeks: Array.from({ length: weeks }, (_, w) => weekDays(addDays(start, 7 * w)).map((date) => ({ date, minutes: byDay.get(date) ?? 0 }))),
  };
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

/** PM-2 — active / on-hold projects you run, most at risk first. Cached per request: the PM strip counts the same rows. */
export const loadMyProjectHealth = cache((ctx: DashboardContext) => healthRows(ctx, { pmId: ctx.user.id, status: { in: ACTIVE } }));

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

/** FN-3 — due soon and late requests across every project. */
export async function loadDueAndLate(ctx: DashboardContext) {
  const rows = (await openRequests(ctx)).filter((r) => r.state);
  const late = rows.filter((r) => r.state === "late").sort((a, b) => b.daysLate - a.daysLate);
  const soon = rows.filter((r) => r.state === "due_soon");
  return { late, soon, lateTotals: sumByCurrency(late), soonTotals: sumByCurrency(soon) };
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
  manualStatus: boolean;
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
  const order: Record<InvoiceStatus, number> = { overdue: 0, payment_submitted: 1, partially_paid: 1, sent: 2, paid: 3, draft: 4, void: 5 };
  return rows
    .map((i) => ({
      id: i.id,
      number: i.number,
      client: i.client.name,
      status: i.status,
      manualStatus: i.statusOverride !== null,
      currency: i.currency,
      remaining: Math.max(0, numOr0(i.total) - numOr0(i.amountPaid)),
      requests: i.paymentRequests.map((r) => {
        const due = isoDate(r.dueDate);
        return { label: r.label, status: r.status === "pending" && due < ctx.today ? ("late" as const) : r.status, dueDate: due };
      }),
    }))
    .sort((a, b) => order[a.status] - order[b.status]);
}

export type ActiveClient = {
  id: string;
  name: string;
  projects: number;
  /** What the table shows: the status set by hand, else the one from its open requests. */
  payment: ClientPaymentState;
  /** From the open requests alone, shown beside a status set by hand. */
  autoPayment: ClientPaymentState;
  manual: boolean;
};

const PAYMENT_ORDER: Record<ClientPaymentState, number> = { late: 0, due_soon: 1, on_track: 2, none: 3 };

/** SL-3 — clients with active / on-hold projects: project count and payment status (late first). */
export async function loadActiveClients(ctx: DashboardContext): Promise<ActiveClient[]> {
  const [projects, requests] = await Promise.all([
    asUser(ctx.user, (tx) =>
      tx.project.findMany({
        where: { kind: "client", status: { in: ACTIVE }, clientId: { not: null } },
        select: { clientId: true, client: { select: { name: true, paymentStatusOverride: true } } },
      }),
    ),
    openRequests(ctx),
  ]);
  const byClient = new Map<string, { id: string; name: string; projects: number; override: ClientPaymentStatus | null }>();
  for (const p of projects) {
    const c = byClient.get(p.clientId!) ?? { id: p.clientId!, name: p.client?.name ?? "—", projects: 0, override: p.client?.paymentStatusOverride ?? null };
    c.projects += 1;
    byClient.set(p.clientId!, c);
  }
  return [...byClient.values()]
    .map(({ override, ...c }) => {
      const states = requests.filter((r) => r.client.id === c.id).map((r) => r.state);
      return { ...c, payment: clientPaymentState(states, override), autoPayment: clientPaymentState(states), manual: override !== null };
    })
    .sort((a, b) => PAYMENT_ORDER[a.payment] - PAYMENT_ORDER[b.payment] || a.name.localeCompare(b.name));
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

/**
 * SL-0 — the sales strip and trend: invoiced vs collected per month over the
 * chosen range (3, 6, 12 months or all time; in IDR at indicative rates)
 * and what isn't billed.
 * Collected uses the settled IDR when Xendit reported it.
 */
export async function loadSalesSummary(ctx: DashboardContext, range: ReportRange = DEFAULT_REPORT_RANGE) {
  const preset = REPORT_RANGES.find((r) => r.value === range)!;
  // "All time" starts at the first sent invoice or payment; the strip always needs this month and the last.
  let span: number = preset.months ?? 2;
  if (preset.months === null) {
    const first = await asUser(ctx.user, async (tx) => {
      const [inv, pay] = await Promise.all([
        tx.invoice.aggregate({ where: { status: { notIn: ["draft", "void"] } }, _min: { issueDate: true } }),
        tx.payment.aggregate({ _min: { paidAt: true } }),
      ]);
      const days = [inv._min.issueDate && isoDate(inv._min.issueDate), pay._min.paidAt && localDay(ctx, pay._min.paidAt)].filter((d): d is IsoDate => Boolean(d));
      return days.length ? monthStart(days.sort()[0]!) : null;
    });
    while (first && addMonths(ctx.monthStart, -(span - 1)) > first) span++;
  }
  const length = Math.max(2, span);
  const months = Array.from({ length }, (_, i) => addMonths(ctx.monthStart, i - (length - 1)));
  const from = months[0]!;
  const { invoices, payments, uninvoiced, drafts } = await asUser(ctx.user, async (tx) => ({
    invoices: await tx.invoice.findMany({
      where: { status: { notIn: ["draft", "void"] }, issueDate: { gte: parseIsoDate(from) } },
      select: { issueDate: true, total: true, currency: true },
    }),
    payments: await tx.payment.findMany({
      where: { paidAt: { gte: since(from) } },
      select: { paidAt: true, amount: true, currency: true, settlementAmountIdr: true },
    }),
    uninvoiced: await tx.project.count({ where: { kind: "client", status: "active", invoices: { none: {} } } }),
    drafts: await tx.invoice.count({ where: { status: "draft", createdBy: ctx.user.id } }),
  }));
  const rates = await getIdrRates([...invoices, ...payments].map((r) => r.currency));
  const toIdr = (items: Money[]) => (rates ? normalizeToIdr(items, rates.toIdr) : items.every((m) => m.currency === "IDR") ? normalizeToIdr(items, {}) : null);

  const trend = months.map((month) => {
    const billed = invoices.filter((i) => monthStart(isoDate(i.issueDate)) === month).map((i) => ({ currency: i.currency, amount: numOr0(i.total) }));
    const paid = payments.filter((p) => monthStart(localDay(ctx, p.paidAt)) === month);
    const settled = paid.reduce((s, p) => s + numOr0(p.settlementAmountIdr), 0);
    const unsettled = toIdr(paid.filter((p) => p.settlementAmountIdr == null).map((p) => ({ currency: p.currency, amount: numOr0(p.amount) })));
    return { month, invoiced: toIdr(billed), collected: unsettled === null ? null : Math.round(settled) + unsettled };
  });
  return {
    trend,
    current: trend.at(-1)!,
    previous: trend.at(-2)!,
    uninvoiced,
    drafts,
    rateDate: rates?.date ?? null,
  };
}

/**
 * DD-0 — your KPIs over the chosen period, against the window before:
 * shots (tasks you finished on internal projects), client tasks finished and
 * how many on time, the projects you logged time on, and your hours — total,
 * billable and per chart bucket.
 */
export async function loadWorkSummary(ctx: DashboardContext, period: WorkPeriod) {
  const uid = ctx.user.id;
  const { entries, tasks } = await asUser(ctx.user, async (tx) => ({
    entries: await tx.timeEntry.findMany({
      where: { userId: uid, entryDate: { gte: parseIsoDate(period.prev.start), lte: parseIsoDate(period.end) } },
      select: { entryDate: true, minutes: true, isBillable: true, oosStatus: true, projectId: true, project: { select: { kind: true } } },
    }),
    tasks: await tx.task
      .findMany({
        where: { ownerId: uid, status: "done", completedAt: { gte: since(period.prev.start) } },
        select: { id: true, dueDate: true, originalDueDate: true, approvedAt: true, completedAt: true, projectId: true, project: { select: { kind: true } } },
      })
      .then(async (rows) => ({ rows, timing: await onTimeInputs(tx, rows, ctx.user.timezone, ctx.today) })),
  }));
  const inCur = (d: IsoDate) => d >= period.start && d <= period.end;
  const inPrev = (d: IsoDate) => d >= period.prev.start && d <= period.prev.end;
  const done = tasks.rows.map((t) => {
    const on = localDay(ctx, t.completedAt!);
    const x = tasks.timing.get(t.id)!;
    return { on, completedOn: x.completedOn ?? on, dueDate: x.dueDate, projectId: t.projectId, internal: t.project.kind === "internal" };
  });
  const time = entries.map((e) => ({ on: isoDate(e.entryDate), minutes: e.minutes, billable: isBillableEntry(e), projectId: e.projectId, internal: e.project?.kind === "internal" }));

  const shots = (inWin: (d: IsoDate) => boolean) => done.filter((t) => t.internal && inWin(t.on)).length;
  const clientDone = done.filter((t) => !t.internal && inCur(t.on));
  const minutes = (inWin: (d: IsoDate) => boolean) => time.filter((e) => inWin(e.on)).reduce((s, e) => s + e.minutes, 0);
  const cur = time.filter((e) => inCur(e.on));

  // A project counts when you logged time on it or finished one of its tasks.
  const projects = new Map<string, boolean>();
  for (const x of [...cur, ...done.filter((t) => inCur(t.on))]) if (x.projectId) projects.set(x.projectId, x.internal);
  const prevProjects = new Set([...time.filter((e) => inPrev(e.on)), ...done.filter((t) => inPrev(t.on))].map((x) => x.projectId).filter(Boolean));
  const internalProjects = [...projects.values()].filter(Boolean).length;

  return {
    shots: { value: shots(inCur), previous: shots(inPrev) },
    tasks: { value: clientDone.length, previous: done.filter((t) => !t.internal && inPrev(t.on)).length, onTimePct: onTimeRate(clientDone) },
    projects: { value: projects.size, previous: prevProjects.size, client: projects.size - internalProjects, internal: internalProjects },
    hours: { value: minutes(inCur), previous: minutes(inPrev), billable: cur.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0) },
    buckets: period.buckets.map((b) => {
      const rows = time.filter((e) => e.on >= b.start && e.on <= b.end);
      return { label: b.label, logged: rows.reduce((s, e) => s + e.minutes, 0), billable: rows.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0) };
    }),
  };
}

/**
 * PM-0 — the projects you run over the chosen period, against the window
 * before: the team's hours (and billable share, per chart bucket), tasks
 * finished and how many on time, out-of-scope hours approved and still
 * waiting, and what's overdue, blocked or ownerless now.
 */
export async function loadPmSummary(ctx: DashboardContext, period: WorkPeriod) {
  const health = await loadMyProjectHealth(ctx);
  const ids = health.map((p) => p.id);
  const { entries, tasks, pendingOos, open } = await asUser(ctx.user, async (tx) => ({
    entries: await tx.timeEntry.findMany({
      where: { projectId: { in: ids }, entryDate: { gte: parseIsoDate(period.prev.start), lte: parseIsoDate(period.end) } },
      select: { entryDate: true, minutes: true, isBillable: true, oosStatus: true },
    }),
    tasks: await tx.task
      .findMany({
        where: { projectId: { in: ids }, status: "done", completedAt: { gte: since(period.prev.start) }, section: { archivedAt: null } },
        select: { id: true, dueDate: true, originalDueDate: true, approvedAt: true, completedAt: true },
      })
      .then(async (rows) => ({ rows, timing: await onTimeInputs(tx, rows, ctx.user.timezone, ctx.today) })),
    pendingOos: await tx.timeEntry.aggregate({ where: { projectId: { in: ids }, oosStatus: "pending" }, _sum: { minutes: true } }),
    open: await tx.task.findMany({
      where: {
        projectId: { in: ids },
        status: { not: "done" },
        section: { archivedAt: null },
        OR: [{ dueDate: { lt: parseIsoDate(ctx.today) } }, { status: "blocked" }, { ownerId: null }],
      },
      select: { dueDate: true, status: true, ownerId: true },
    }),
  }));
  const inCur = (d: IsoDate) => d >= period.start && d <= period.end;
  const inPrev = (d: IsoDate) => d >= period.prev.start && d <= period.prev.end;
  const time = entries.map((e) => ({ on: isoDate(e.entryDate), minutes: e.minutes, billable: isBillableEntry(e), oos: e.oosStatus }));
  const done = tasks.rows.map((t) => {
    const on = localDay(ctx, t.completedAt!);
    const x = tasks.timing.get(t.id)!;
    return { on, completedOn: x.completedOn ?? on, dueDate: x.dueDate };
  });
  const sum = (rows: { minutes: number }[]) => rows.reduce((s, e) => s + e.minutes, 0);
  const cur = time.filter((e) => inCur(e.on));
  const curDone = done.filter((t) => inCur(t.on));
  const risks = open.map((t) => taskRisk({ dueDate: t.dueDate ? isoDate(t.dueDate) : null, status: t.status, ownerId: t.ownerId }, ctx.today));
  const count = <T,>(rows: T[], f: (r: T) => boolean) => rows.filter(f).length;
  return {
    projects: { value: health.length, overBudget: count(health, (p) => p.status === "over_budget"), warning: count(health, (p) => p.status === "warning") },
    hours: { value: sum(cur), previous: sum(time.filter((e) => inPrev(e.on))), billable: sum(cur.filter((e) => e.billable)) },
    tasks: { value: curDone.length, previous: count(done, (t) => inPrev(t.on)), onTimePct: onTimeRate(curDone) },
    oos: {
      approved: sum(cur.filter((e) => e.oos === "approved")),
      previous: sum(time.filter((e) => inPrev(e.on) && e.oos === "approved")),
      pending: pendingOos._sum.minutes ?? 0,
    },
    risk: { overdue: count(risks, (r) => r === "overdue"), blocked: count(risks, (r) => r === "blocked"), noOwner: count(risks, (r) => r === "no_owner") },
    buckets: period.buckets.map((b) => {
      const rows = time.filter((e) => e.on >= b.start && e.on <= b.end);
      return { label: b.label, logged: sum(rows), billable: sum(rows.filter((e) => e.billable)) };
    }),
  };
}

// ---------------------------------------------------------------------------
// PM dashboard: your projects' standing and calendar, the people on them
// ---------------------------------------------------------------------------

export type PmProject = {
  id: string;
  code: string;
  name: string;
  client: string;
  status: "active" | "on_hold";
  startDate: IsoDate;
  endDate: IsoDate | null;
  color: HrEventColor | null;
  standing: ProjectStanding;
  reasons: string[];
  openTasks: number;
};

/**
 * Active / on-hold projects you run with where each stands (delayed, at risk,
 * on track — `projectStanding`), most serious first. Cached per request: the
 * calendar and the status list read the same rows.
 */
export const loadPmProjects = cache(async (ctx: DashboardContext): Promise<PmProject[]> => {
  const health = new Map((await loadMyProjectHealth(ctx)).map((h) => [h.id, h]));
  const { projects, open } = await asUser(ctx.user, async (tx) => {
    const projects = await tx.project.findMany({
      where: { pmId: ctx.user.id, status: { in: ACTIVE } },
      select: { id: true, code: true, name: true, status: true, startDate: true, endDate: true, calendarColor: true, client: { select: { name: true } } },
    });
    const open = await tx.task.groupBy({
      by: ["projectId", "status"],
      where: { projectId: { in: projects.map((p) => p.id) }, status: { not: "done" }, section: { archivedAt: null } },
      _count: true,
    });
    return { projects, open };
  });
  const order = (s: ProjectStanding) => PROJECT_STANDINGS.indexOf(s);
  return projects
    .map((p) => {
      const tasks = open.filter((o) => o.projectId === p.id);
      const openTasks = tasks.reduce((n, o) => n + o._count, 0);
      const h = health.get(p.id);
      const endDate = p.endDate ? isoDate(p.endDate) : null;
      const status = p.status as "active" | "on_hold";
      const { standing, reasons } = projectStanding(
        { status, endDate, health: h?.status ?? "no_budget", overdueTasks: h?.overdueTasks ?? 0, blockedTasks: tasks.find((o) => o.status === "blocked")?._count ?? 0, openTasks },
        ctx.today,
      );
      return { id: p.id, code: p.code, name: p.name, client: p.client?.name ?? "Internal", status, startDate: isoDate(p.startDate), endDate, color: p.calendarColor, standing, reasons, openTasks };
    })
    .sort((a, b) => order(a.standing) - order(b.standing) || b.reasons.length - a.reasons.length || (a.endDate ?? "9999").localeCompare(b.endDate ?? "9999") || a.code.localeCompare(b.code));
});

export type PmMemberProject = {
  id: string;
  code: string;
  name: string;
  billable: boolean;
  pm: string;
  /** You run it — its tasks and time are yours to see. */
  mine: boolean;
  todayMinutes: number;
  openTasks: number;
  overdueTasks: number;
  nextDue: IsoDate | null;
};

export type PmMemberRow = {
  id: string;
  name: string;
  role: UserRole;
  avatarUrl: string | null;
  away: LeaveKind | null;
  todayMinutes: number;
  weekMinutes: number;
  weekBillableMinutes: number;
  capacityHours: number;
  /** Billable hours this week against capacity, in percent. */
  utilization: number | null;
  /** Projects they're on today (started, not completed or archived), yours first. */
  projects: PmMemberProject[];
};

/**
 * Everyone on the projects you run (you aside): who's away, the hours they
 * logged today and this week, billable utilization, and every running project
 * they're on today. Time and tasks come back under RLS, so they cover the
 * projects you're a member of; the summary counts the same rows.
 */
export async function loadPmTeam(ctx: DashboardContext) {
  const me = ctx.user.id;
  const [settings, data] = await Promise.all([
    getSettings(),
    asUser(ctx.user, async (tx) => {
      const members = await tx.projectMember.findMany({
        where: { project: { pmId: me, status: { in: ACTIVE } }, userId: { not: me }, user: { status: "active" } },
        select: { user: { select: { id: true, fullName: true, role: true, avatarUrl: true } } },
      });
      const people = [...new Map(members.map((m) => [m.user.id, m.user])).values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
      const ids = people.map((p) => p.id);
      const week = { gte: parseIsoDate(ctx.weekStart), lte: parseIsoDate(ctx.weekEnd) };
      return {
        people,
        memberships: await tx.projectMember.findMany({
          where: { userId: { in: ids }, project: { status: { in: ACTIVE }, startDate: { lte: parseIsoDate(ctx.today) } } },
          select: { userId: true, project: { select: { id: true, code: true, name: true, kind: true, pmId: true, pm: { select: { fullName: true } } } } },
        }),
        entries: await tx.timeEntry.findMany({ where: { userId: { in: ids }, entryDate: week }, select: { userId: true, projectId: true, entryDate: true, minutes: true, isBillable: true, oosStatus: true } }),
        tasks: await tx.task.findMany({
          where: { ownerId: { in: ids }, status: { not: "done" }, section: { archivedAt: null }, project: { status: { in: ACTIVE } } },
          select: { ownerId: true, projectId: true, dueDate: true },
        }),
        cap: await capacityInputs(tx, ids, ctx.weekEnd, ctx.weekStart),
        holidays: await holidaySet(tx, ctx.weekStart, ctx.weekEnd),
      };
    }),
  ]);
  const sum = (rows: { minutes: number }[]) => rows.reduce((n, e) => n + e.minutes, 0);
  const rows: PmMemberRow[] = data.people.map((p) => {
    const entries = data.entries.filter((e) => e.userId === p.id);
    const today = entries.filter((e) => isoDate(e.entryDate) === ctx.today);
    const tasks = data.tasks.filter((t) => t.ownerId === p.id);
    const overrides = data.cap.overridesOf(p.id);
    const leave = overrides.filter((o) => o.kind).map((o) => ({ kind: o.kind!, start: o.start, end: o.end }));
    const capacityHours = capacityHours_(data.cap.capacityOf(p.id), overrides, { start: ctx.weekStart, end: ctx.weekEnd }, settings.workdays, data.holidays);
    const weekBillableMinutes = billableMinutesOf(entries);
    const projects = data.memberships
      .filter((m) => m.userId === p.id)
      .map(({ project: pr }): PmMemberProject => {
        const own = tasks.filter((t) => t.projectId === pr.id);
        const due = own.map((t) => (t.dueDate ? isoDate(t.dueDate) : null)).filter((d): d is IsoDate => d !== null).sort();
        return {
          id: pr.id,
          code: pr.code,
          name: pr.name,
          billable: pr.kind === "client",
          pm: pr.pm.fullName,
          mine: pr.pmId === me,
          todayMinutes: sum(today.filter((e) => e.projectId === pr.id)),
          openTasks: own.length,
          overdueTasks: due.filter((d) => d < ctx.today).length,
          nextDue: due.find((d) => d >= ctx.today) ?? null,
        };
      })
      .sort((a, b) => Number(b.mine) - Number(a.mine) || b.todayMinutes - a.todayMinutes || a.code.localeCompare(b.code));
    return {
      id: p.id,
      name: p.fullName,
      role: p.role,
      avatarUrl: p.avatarUrl,
      away: leave.find((l) => l.start <= ctx.today && l.end >= ctx.today)?.kind ?? null,
      todayMinutes: sum(today),
      weekMinutes: sum(entries),
      weekBillableMinutes,
      capacityHours,
      utilization: utilizationPct(weekBillableMinutes, capacityHours),
      projects,
    };
  });
  const present = rows.filter((r) => !r.away);
  const capacityHours = rows.reduce((n, r) => n + r.capacityHours, 0);
  const billableMinutes = rows.reduce((n, r) => n + r.weekBillableMinutes, 0);
  return {
    rows,
    summary: {
      people: rows.length,
      onBillable: present.filter((r) => r.projects.some((pr) => pr.billable)).length,
      present: present.length,
      away: rows.length - present.length,
      loggedToday: rows.filter((r) => r.todayMinutes > 0).length,
      todayMinutes: rows.reduce((n, r) => n + r.todayMinutes, 0),
      billableMinutes,
      capacityHours: Math.round(capacityHours * 10) / 10,
      utilization: utilizationPct(billableMinutes, capacityHours),
      overdueTasks: rows.reduce((n, r) => n + r.projects.reduce((m, pr) => m + pr.overdueTasks, 0), 0),
    },
  };
}
