import "server-only";
import { loadObligations } from "@/lib/finance/ops";
import type { HrEventRecurrence, LeaveKind, LeaveStatus, Prisma, TaskPriority, TaskStatus, UserRole } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { numOr0 } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { addDays, addMonths, isoDate, isoWeekday, monthStart, parseIsoDate, weekStart, type IsoDate } from "@/lib/time/pure";
import { dayStatus, expandEvents, sundayOf, workloadPct, type DayStatus, type HrOccurrence } from "@/lib/hr/pure";
import { capacityHours as capacityOf, workloadFromOverdue } from "@/lib/metrics/pure";
import { capacityInputs, holidaySet } from "@/lib/metrics/queries";

/**
 * Data for the HR dashboard and leave screens. Every read runs under RLS:
 * the calendar is HR-only, leave requests are the requester's or HR's, and
 * HR reads every task (docs/DECISIONS.md).
 */

const orNull = (d: Date | null) => (d ? isoDate(d) : null);

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export type HrSeries = { id: string; startDate: IsoDate; endDate: IsoDate; recurrence: HrEventRecurrence; repeatUntil: IsoDate | null };
export type LeaveBar = { key: string; userId: string; name: string; kind: LeaveKind; startDate: IsoDate; endDate: IsoDate; halfDay: boolean };

/** HR events touching [from, to] as occurrences ("only this one" changes applied), and each series' own timing. */
async function eventsIn(user: CurrentUser, from: IsoDate, to: IsoDate) {
  const { events, exceptions } = await asUser(user, async (tx) => {
    const events = await tx.hrEvent.findMany({
      where: { startDate: { lte: parseIsoDate(to) }, OR: [{ recurrence: { not: "none" }, OR: [{ repeatUntil: null }, { repeatUntil: { gte: parseIsoDate(addDays(from, -62)) } }] }, { endDate: { gte: parseIsoDate(from) } }] },
    });
    return { events, exceptions: await tx.hrEventException.findMany({ where: { eventId: { in: events.map((e) => e.id) } } }) };
  });
  const series = events.map((e) => ({
    id: e.id,
    title: e.title,
    notes: e.notes,
    color: e.color,
    startDate: isoDate(e.startDate),
    endDate: isoDate(e.endDate),
    allDay: e.allDay,
    startTime: e.startTime,
    endTime: e.endTime,
    recurrence: e.recurrence,
    repeatUntil: orNull(e.repeatUntil),
  }));
  const occurrences: HrOccurrence[] = expandEvents(
    series,
    exceptions.map((x) => ({
      eventId: x.eventId,
      occurrenceDate: isoDate(x.occurrenceDate),
      cancelled: x.cancelled,
      title: x.title,
      notes: x.notes,
      color: x.color,
      startDate: orNull(x.startDate),
      endDate: orNull(x.endDate),
      allDay: x.allDay,
      startTime: x.startTime,
      endTime: x.endTime,
    })),
    from,
    to,
  );
  return {
    occurrences,
    series: Object.fromEntries(series.map((s): [string, HrSeries] => [s.id, { id: s.id, startDate: s.startDate, endDate: s.endDate, recurrence: s.recurrence, repeatUntil: s.repeatUntil }])),
  };
}

export type CalendarView = "month" | "week";

/**
 * The calendar's range — a month as whole Sunday-first weeks, or the one week
 * holding `anchor` — with its occurrences, each series' own timing, and team
 * time off.
 */
export async function loadHrCalendar(user: CurrentUser, view: CalendarView, anchor: IsoDate) {
  const from = view === "week" ? sundayOf(anchor) : sundayOf(monthStart(anchor));
  const to = view === "week" ? addDays(from, 6) : addDays(sundayOf(addDays(addMonths(monthStart(anchor), 1), -1)), 6);
  const [events, leave, obligations] = await Promise.all([
    eventsIn(user, from, to),
    asUser(user, (tx) =>
      tx.capacityOverride.findMany({
        where: { kind: { not: null }, periodStart: { lte: parseIsoDate(to) }, periodEnd: { gte: parseIsoDate(from) } },
        include: { user: { select: { fullName: true } }, leaveRequest: { select: { halfDay: true } } },
      }),
    ),
    // Payroll and BPJS — the same data as Finance's obligations calendar (RLS: People module).
    loadObligations(user, from, to),
  ]);
  const bars: LeaveBar[] = leave.map((l) => ({
    key: `leave:${l.id}`,
    userId: l.userId,
    name: l.user.fullName,
    kind: l.kind!,
    startDate: isoDate(l.periodStart),
    endDate: isoDate(l.periodEnd),
    halfDay: l.leaveRequest?.halfDay ?? false,
  }));
  const payDays = obligations.flatMap((o) =>
    o.kind === "payroll" || o.kind === "bpjs" ? [{ key: `ob:${o.key}`, date: o.startDate, title: o.title, kind: o.kind, done: o.done }] : [],
  );
  return { view, month: monthStart(anchor), weekStart: view === "week" ? from : null, ...events, leave: bars, obligations: payDays };
}

/** HR's agenda: what's on today, the next seven days, then the rest of the month. */
export async function loadHrAgenda(user: CurrentUser, today: IsoDate) {
  const week = addDays(today, 7);
  const monthEnd = addDays(addMonths(monthStart(today), 1), -1);
  const { occurrences } = await eventsIn(user, today, monthEnd > week ? monthEnd : week);
  return {
    today: occurrences.filter((o) => o.startDate <= today && o.endDate >= today),
    upcoming: occurrences.filter((o) => o.startDate > today && o.startDate <= week),
    later: occurrences.filter((o) => o.startDate > week),
  };
}

// ---------------------------------------------------------------------------
// People today and their workload
// ---------------------------------------------------------------------------

type Person = { id: string; name: string; role: UserRole; avatarUrl: string | null };

/** One project (or non-project time) a person logged today, with the tasks under it. */
export type DayProject = {
  key: string;
  code: string | null;
  name: string;
  minutes: number;
  tasks: { key: string; title: string; minutes: number; dueDate: IsoDate | null; status: TaskStatus | null }[];
};

export type TodayRow = Person & {
  status: DayStatus;
  minutes: number;
  /** What they logged today, per project — most time first. */
  day: DayProject[];
  /** Nothing logged yet: a task they have in progress. */
  inProgressTask: { title: string; code: string } | null;
  workload: Omit<WorkloadRow, keyof Person>;
};

export type WorkloadTask = { id: string; title: string; projectCode: string; projectId: string; status: TaskStatus; priority: TaskPriority; dueDate: IsoDate | null; estimateHours: number | null };
export type WorkloadRow = Person & {
  open: number;
  overdue: number;
  dueThisWeek: number;
  /** Estimated hours of open tasks due by the end of the week (overdue included). */
  plannedHours: number;
  /** Weekly hours less this week's time off and holidays. */
  capacityHours: number;
  pct: number | null;
  /** Most of the planned hours are overdue work piling up. */
  fromOverdue: boolean;
  noEstimate: number;
  tasks: WorkloadTask[];
};

/** Every active member: today's status and time per project, and their open work this week. */
export async function loadTeam(user: CurrentUser, today: IsoDate) {
  const ws = weekStart(today);
  const we = addDays(ws, 6);
  const [settings, data] = await Promise.all([
    getSettings(),
    asUser(user, async (tx) => {
      const people = await tx.profile.findMany({ where: { status: "active" }, select: { id: true, fullName: true, role: true, avatarUrl: true }, orderBy: { fullName: "asc" } });
      const ids = people.map((p) => p.id);
      return {
        people,
        entries: await tx.timeEntry.findMany({
          where: { userId: { in: ids }, entryDate: parseIsoDate(today) },
          include: { task: { select: { title: true, dueDate: true, status: true } }, project: { select: { code: true, name: true } }, category: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        }),
        tasks: await tx.task.findMany({
          where: { ownerId: { in: ids }, status: { not: "done" }, section: { archivedAt: null }, project: { status: { in: ["active", "on_hold"] } } },
          select: { id: true, title: true, ownerId: true, status: true, priority: true, dueDate: true, estimateHours: true, projectId: true, project: { select: { code: true } } },
          orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        }),
        cap: await capacityInputs(tx, ids, we, ws),
        holidays: await holidaySet(tx, ws, we),
        attendance: await tx.attendance.findMany({ where: { userId: { in: ids }, date: parseIsoDate(today) }, select: { userId: true, status: true } }),
      };
    }),
  ]);
  const workdays = settings.workdays;
  const isWorkday = workdays.includes(isoWeekday(today));

  const today_: TodayRow[] = [];
  const workload: WorkloadRow[] = [];
  for (const p of data.people) {
    const person: Person = { id: p.id, name: p.fullName, role: p.role, avatarUrl: p.avatarUrl };
    const entries = data.entries.filter((e) => e.userId === p.id);
    const tasks = data.tasks.filter((t) => t.ownerId === p.id);
    const overrides = data.cap.overridesOf(p.id);
    const leaveToday = overrides.find((l) => l.kind && l.start <= today && l.end >= today)?.kind ?? null;
    const inProgress = tasks.filter((t) => t.status === "in_progress");
    const minutes = entries.reduce((sum, e) => sum + e.minutes, 0);
    const byProject = new Map<string, DayProject>();
    for (const e of entries) {
      const key = e.projectId ?? "none";
      const group = byProject.get(key) ?? { key, code: e.project?.code ?? null, name: e.project?.name ?? "Non-project", minutes: 0, tasks: [] };
      group.minutes += e.minutes;
      const taskKey = e.taskId ?? `category:${e.categoryId ?? "none"}`;
      const task = group.tasks.find((t) => t.key === taskKey);
      if (task) task.minutes += e.minutes;
      else group.tasks.push({ key: taskKey, title: e.task?.title ?? e.category?.name ?? "Time logged", minutes: e.minutes, dueDate: orNull(e.task?.dueDate ?? null), status: e.task?.status ?? null });
      byProject.set(key, group);
    }
    const day = [...byProject.values()]
      .map((g) => ({ ...g, tasks: g.tasks.sort((a, b) => b.minutes - a.minutes) }))
      .sort((a, b) => Number(a.code === null) - Number(b.code === null) || b.minutes - a.minutes);
    const row = {
      ...person,
      status: dayStatus({
        leave: leaveToday,
        attendance: data.attendance.find((a) => a.userId === p.id)?.status ?? null,
        workday: isWorkday && !data.holidays.has(today),
      }),
      minutes,
      day,
      inProgressTask: inProgress[0] ? { title: inProgress[0].title, code: inProgress[0].project.code } : null,
    };

    const capacityHours = capacityOf(data.cap.capacityOf(p.id), overrides, { start: ws, end: we }, workdays, data.holidays);
    const rows: WorkloadTask[] = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      projectCode: t.project.code,
      projectId: t.projectId,
      status: t.status,
      priority: t.priority,
      dueDate: orNull(t.dueDate),
      estimateHours: t.estimateHours == null ? null : numOr0(t.estimateHours),
    }));
    const planned = rows.filter((t) => t.dueDate && t.dueDate <= we);
    const plannedHours = Math.round(planned.reduce((s, t) => s + (t.estimateHours ?? 0), 0) * 10) / 10;
    const overdueHours = planned.filter((t) => t.dueDate! < today).reduce((s, t) => s + (t.estimateHours ?? 0), 0);
    const load = {
      open: rows.length,
      overdue: rows.filter((t) => t.dueDate && t.dueDate < today).length,
      dueThisWeek: rows.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= we).length,
      plannedHours,
      capacityHours,
      pct: workloadPct(plannedHours, capacityHours),
      fromOverdue: workloadFromOverdue(overdueHours, plannedHours),
      noEstimate: planned.filter((t) => t.estimateHours == null).length,
      tasks: rows,
    };
    workload.push({ ...person, ...load });
    today_.push({ ...row, workload: load });
  }
  const order: DayStatus[] = ["present", "remote", "not_checked_in", "annual_leave", "permit", "sick", "other_leave", "off"];
  return {
    today: today_.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.name.localeCompare(b.name)),
    workload: workload.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.overdue - a.overdue || a.name.localeCompare(b.name)),
  };
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

export type LeaveRequestRow = {
  id: string;
  person: { id: string; name: string };
  kind: LeaveKind;
  startDate: IsoDate;
  endDate: IsoDate;
  halfDay: boolean;
  reason: string | null;
  status: LeaveStatus;
  decidedBy: string | null;
  decisionNote: string | null;
  createdAt: Date;
};

const requestInclude = { user: { select: { id: true, fullName: true } }, decider: { select: { fullName: true } } } as const;
type RequestWithPeople = Awaited<ReturnType<typeof findRequests>>[number];
function findRequests(user: CurrentUser, where: Prisma.LeaveRequestWhereInput) {
  return asUser(user, (tx) => tx.leaveRequest.findMany({ where, include: requestInclude, orderBy: { startDate: "asc" } }));
}
const toRow = (r: RequestWithPeople): LeaveRequestRow => ({
  id: r.id,
  person: { id: r.user.id, name: r.user.fullName },
  kind: r.kind,
  startDate: isoDate(r.startDate),
  endDate: isoDate(r.endDate),
  halfDay: r.halfDay,
  reason: r.reason,
  status: r.status,
  decidedBy: r.decider?.fullName ?? null,
  decisionNote: r.decisionNote,
  createdAt: r.createdAt,
});

/** HR: requests waiting for a decision, and approved time off from today through the next 30 days. */
export async function loadLeaveOverview(user: CurrentUser, today: IsoDate) {
  const [pending, upcoming] = await Promise.all([
    findRequests(user, { status: "pending" }),
    findRequests(user, { status: "approved", endDate: { gte: parseIsoDate(today) }, startDate: { lte: parseIsoDate(addDays(today, 30)) } }),
  ]);
  const up = upcoming.map(toRow);
  return { pending: pending.map(toRow), today: up.filter((r) => r.startDate <= today), upcoming: up.filter((r) => r.startDate > today) };
}

/** A member's own requests, newest first. */
export async function loadMyLeave(user: CurrentUser) {
  const rows = await asUser(user, (tx) => tx.leaveRequest.findMany({ where: { userId: user.id }, include: requestInclude, orderBy: { startDate: "desc" }, take: 20 }));
  return rows.map(toRow);
}
