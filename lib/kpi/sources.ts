import "server-only";
import type { Prisma, WorkLogKind } from "@prisma/client";
import { getSettings } from "@/lib/settings";
import { addDays, isoDate, isoWeekday, parseIsoDate, todayIn, type IsoDate } from "@/lib/time/pure";
import { effectiveDue, isOnTime, type Calendar, type TaskTiming } from "@/lib/tasks/pure";
import { isLogSource, type MetricDefinition, type MetricSource } from "@/lib/kpi/definition";
import type { MetricRow, Window } from "@/lib/kpi/pure";

/**
 * Each metric source as rows (lib/kpi/pure MetricRow). The engine runs on the
 * system connection after the viewer's right to see the person's KPI was
 * proven under RLS (app.can_view_kpi) — the same rule the snapshot job uses.
 */

type Db = Prisma.TransactionClient;
const TZ = "Asia/Jakarta";
const local = (d: Date) => todayIn(TZ, d);
const num = (d: Prisma.Decimal | null | undefined) => (d == null ? null : Number(d));

export async function calendar(db: Db): Promise<Calendar> {
  const [settings, holidays] = await Promise.all([getSettings(), db.publicHoliday.findMany({ select: { date: true } })]);
  return { workdays: settings.workdays, holidays: new Set(holidays.map((h) => isoDate(h.date))) };
}

/** A little before and after the window, so due dates moved by review delays still land in it. */
const padded = (w: Window) => ({ gte: parseIsoDate(addDays(w.start, -45)), lte: parseIsoDate(addDays(w.end, 45)) });

async function taskRows(db: Db, users: string[], w: Window, def: MetricDefinition, cal: Calendar, today: IsoDate): Promise<MetricRow[]> {
  const tasks = await db.task.findMany({
    where: { ownerId: { in: users }, section: { archivedAt: null }, OR: [{ dueDate: padded(w) }, { approvedAt: { gte: padded(w).gte } }, { completedAt: { gte: padded(w).gte } }] },
    select: {
      id: true, ownerId: true, status: true, dueDate: true, originalDueDate: true, approvedAt: true, completedAt: true, sectionId: true, deliverableUrl: true,
      type: { select: { key: true } },
      project: { select: { kind: true } },
      reviewRounds: { select: { slaDueAt: true, decidedAt: true } },
      dueChanges: { select: { toDate: true, approvedAt: true } },
    },
  });
  const rows: MetricRow[] = [];
  for (const t of tasks) {
    const approved = t.approvedAt ?? (t.status === "done" ? t.completedAt : null);
    const first = t.originalDueDate ?? t.dueDate;
    const timing: TaskTiming = {
      firstDue: first ? isoDate(first) : null,
      changes: t.dueChanges.map((c) => ({ toDate: isoDate(c.toDate), approvedOn: c.approvedAt ? local(c.approvedAt) : null })),
      rounds: t.reviewRounds.map((r) => ({ slaDueOn: local(r.slaDueAt), decidedOn: r.decidedAt ? local(r.decidedAt) : null })),
      approvedOn: approved ? local(approved) : null,
    };
    const due = effectiveDue(timing, today, cal);
    let date: IsoDate | null;
    if (def.dateBy === "approved") date = timing.approvedOn;
    else {
      // Due-based: a task counts once it's approved or its due date has passed; no due date, no row.
      if (!due || (!timing.approvedOn && due >= today)) continue;
      date = due;
    }
    if (!date) continue;
    rows.push({
      userId: t.ownerId!,
      date,
      status: t.status === "done" ? "approved" : t.status,
      typeKey: t.type?.key ?? null,
      onTime: isOnTime(timing, today, cal) ?? (due && due < today ? false : null),
      projectKind: t.project.kind,
      group: t.deliverableUrl ?? t.sectionId,
    });
  }
  return rows;
}

async function logRows(db: Db, users: string[], kind: WorkLogKind, w: Window, today: IsoDate): Promise<MetricRow[]> {
  const logs = await db.workLog.findMany({
    where: { userId: { in: users }, kind, occurredOn: padded(w) },
    select: { userId: true, occurredOn: true, status: true, tags: true, value: true, total: true, taskId: true, link: true, responseDue: true, project: { select: { kind: true } } },
  });
  return logs.map((l) => ({
    userId: l.userId,
    date: isoDate(l.occurredOn),
    // An idea not answered within its 3 working days counts anyway.
    status: l.status === "submitted" && l.responseDue && isoDate(l.responseDue) < today ? "approved" : l.status,
    tags: l.tags,
    value: num(l.value),
    total: num(l.total),
    projectKind: l.project?.kind ?? null,
    group: l.taskId ?? l.link ?? null,
  }));
}

async function projectRows(db: Db, users: string[], w: Window, def: MetricDefinition): Promise<MetricRow[]> {
  const role = def.filters.projectRole ?? "pm";
  const projects = await db.project.findMany({
    where: {
      status: { not: "archived" },
      startDate: { lte: parseIsoDate(w.end) },
      ...(role === "pm" ? { pmId: { in: users } } : { members: { some: { userId: { in: users } } } }),
    },
    select: { id: true, pmId: true, kind: true, status: true, endDate: true, updatedAt: true, members: { select: { userId: true } } },
  });
  const testimonies = await db.workLog.findMany({
    where: { kind: "testimony", status: "approved", projectId: { in: projects.map((p) => p.id) } },
    select: { projectId: true, occurredOn: true },
  });
  const rows: MetricRow[] = [];
  for (const p of projects) {
    const owners = role === "pm" ? [p.pmId] : p.members.map((m) => m.userId).filter((u) => users.includes(u));
    const completedOn = p.status === "completed" ? local(p.updatedAt) : null;
    const end = p.endDate ? isoDate(p.endDate) : null;
    const tags: string[] = [];
    if (completedOn && (!end || completedOn <= end)) tags.push("on_time");
    // A testimony up to 14 days after the project closed (or any time during it).
    if (testimonies.some((t) => t.projectId === p.id && (!completedOn || isoDate(t.occurredOn) <= addDays(completedOn, 14)))) tags.push("testimony");
    for (const u of owners) {
      rows.push({
        userId: u,
        // Completed projects count on their closing day; running ones once, at the window's end.
        date: completedOn ?? (p.status === "active" || p.status === "on_hold" ? w.end : "0000-01-01"),
        status: p.status,
        tags,
        projectKind: p.kind,
        projectRole: role,
      });
    }
  }
  return rows;
}

async function attendanceRows(db: Db, users: string[], w: Window, cal: Calendar): Promise<MetricRow[]> {
  const [att, entries, leave] = await Promise.all([
    db.attendance.findMany({ where: { userId: { in: users }, date: { gte: parseIsoDate(w.start), lte: parseIsoDate(w.end) } } }),
    db.timeEntry.findMany({ where: { userId: { in: users }, projectId: { not: null }, entryDate: { gte: parseIsoDate(w.start), lte: parseIsoDate(w.end) } }, select: { userId: true, entryDate: true } }),
    db.capacityOverride.findMany({ where: { userId: { in: users }, kind: { not: null }, periodStart: { lte: parseIsoDate(w.end) }, periodEnd: { gte: parseIsoDate(w.start) } } }),
  ]);
  const rows: MetricRow[] = [];
  for (const u of users) {
    for (let d = w.start; d <= w.end; d = addDays(d, 1)) {
      if (!cal.workdays.includes(isoWeekday(d)) || cal.holidays.has(d)) continue;
      // Leave days aren't workdays for this person.
      if (leave.some((l) => l.userId === u && isoDate(l.periodStart) <= d && isoDate(l.periodEnd) >= d)) continue;
      const a = att.find((x) => x.userId === u && isoDate(x.date) === d);
      const logged = entries.some((e) => e.userId === u && isoDate(e.entryDate) === d);
      rows.push({ userId: u, date: d, status: a?.status ?? "none", tags: logged ? ["logged"] : [] });
    }
  }
  return rows;
}

async function timesheetRows(db: Db, users: string[], w: Window): Promise<MetricRow[]> {
  const entries = await db.timeEntry.findMany({
    where: { userId: { in: users }, entryDate: { gte: parseIsoDate(w.start), lte: parseIsoDate(w.end) } },
    select: { userId: true, entryDate: true, minutes: true, isBillable: true, oosStatus: true, project: { select: { kind: true } } },
  });
  return entries.map((e) => ({
    userId: e.userId,
    date: isoDate(e.entryDate),
    value: Math.round((e.minutes / 60) * 100) / 100,
    tags: [e.isBillable && e.oosStatus !== "pending" ? "billable" : "non_billable"],
    projectKind: e.project?.kind ?? null,
  }));
}

async function reviewRows(db: Db, users: string[], w: Window): Promise<MetricRow[]> {
  const rounds = await db.reviewRound.findMany({
    where: { reviewerId: { in: users }, decidedAt: { gte: padded(w).gte, lte: padded(w).lte } },
    select: { reviewerId: true, decidedAt: true, slaDueAt: true, decision: true },
  });
  return rounds.map((r) => ({ userId: r.reviewerId!, date: local(r.decidedAt!), onTime: r.decidedAt! <= r.slaDueAt, status: r.decision ?? "withdrawn" }));
}

async function ratingRows(db: Db, users: string[], w: Window, metricId: string): Promise<MetricRow[]> {
  const responses = await db.ratingResponse.findMany({
    where: { subjectId: { in: users }, periodStart: { gte: parseIsoDate(w.start), lte: parseIsoDate(w.end) }, form: { metricId } },
    select: { subjectId: true, periodStart: true, average: true, approvedAt: true, form: { select: { needsApproval: true } } },
  });
  // Self-assessments count once People approved them; peers' ratings in one
  // period average out naturally (one row each).
  return responses.filter((r) => !r.form.needsApproval || r.approvedAt).map((r) => ({ userId: r.subjectId, date: isoDate(r.periodStart), value: Number(r.average) }));
}

async function manualRows(db: Db, users: string[], w: Window, metricId: string): Promise<MetricRow[]> {
  const entries = await db.manualEntry.findMany({ where: { metricId, userId: { in: users }, occurredOn: { gte: parseIsoDate(w.start), lte: parseIsoDate(w.end) } } });
  return entries.map((e) => ({ userId: e.userId, date: isoDate(e.occurredOn), value: Number(e.value) }));
}

/** Rows of one metric's source for these people over (about) the window. */
export async function sourceRows(
  db: Db,
  source: MetricSource,
  users: string[],
  w: Window,
  def: MetricDefinition,
  ctx: { metricId: string; cal: Calendar; today: IsoDate },
): Promise<MetricRow[]> {
  if (!users.length) return [];
  if (isLogSource(source)) return logRows(db, users, source, w, ctx.today);
  switch (source) {
    case "task":
      return taskRows(db, users, w, def, ctx.cal, ctx.today);
    case "project":
      return projectRows(db, users, w, def);
    case "attendance":
      return attendanceRows(db, users, w, ctx.cal);
    case "timesheet":
      return timesheetRows(db, users, w);
    case "review":
      return reviewRows(db, users, w);
    case "rating":
      return ratingRows(db, users, w, ctx.metricId);
    case "manual":
      return manualRows(db, users, w, ctx.metricId);
    default:
      return [];
  }
}
