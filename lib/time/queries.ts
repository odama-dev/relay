import "server-only";
import type { OosStatus } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { perms } from "@/lib/roles";
import { addDays, isoDate, parseIsoDate, todayIn, weekDays, weekStart, isoWeekday, type IsoDate } from "@/lib/time/pure";

export type TaskOption = {
  id: string;
  title: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  /** Out-of-scope only exists on client projects (M3.3). */
  clientProject: boolean;
  recent: boolean;
};

export type LogTimeOptions = {
  tasks: TaskOption[];
  categories: { id: string; name: string }[];
  /** Mondays of locked weeks — their days can't be picked (M3.1). */
  lockedWeeks: IsoDate[];
  today: IsoDate;
};

/**
 * Choices for the log-time form (M3.1): tasks of Active / On hold projects the
 * user is on, recently worked ones first; active categories; locked weeks.
 */
export async function logTimeOptions(user: CurrentUser): Promise<LogTimeOptions> {
  const today = todayIn(user.timezone);
  return asUser(user, async (tx) => {
    const [tasks, recent, categories, locks] = await Promise.all([
      tx.task.findMany({
        where: {
          project: {
            status: { in: ["active", "on_hold"] },
            ...(user.role === "c_level" ? {} : { OR: [{ pmId: user.id }, { members: { some: { userId: user.id } } }] }),
          },
          section: { archivedAt: null },
        },
        select: { id: true, title: true, status: true, project: { select: { id: true, code: true, name: true, kind: true } } },
        orderBy: [{ project: { code: "asc" } }, { position: "asc" }],
        take: 1500,
      }),
      tx.timeEntry.findMany({
        where: { userId: user.id, taskId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { taskId: true },
        take: 200,
      }),
      tx.workCategory.findMany({ where: { isActive: true }, orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
      tx.timesheetLock.findMany({ where: { weekStart: { gte: parseIsoDate(addDays(today, -400)) } }, select: { weekStart: true } }),
    ]);

    const recency = new Map<string, number>();
    for (const [i, r] of recent.entries()) if (r.taskId && !recency.has(r.taskId)) recency.set(r.taskId, i);

    const options: TaskOption[] = tasks
      // Done tasks stay pickable only if you worked on them lately.
      .filter((t) => t.status !== "done" || recency.has(t.id))
      .map((t) => ({
        id: t.id,
        title: t.title,
        projectId: t.project.id,
        projectCode: t.project.code,
        projectName: t.project.name,
        clientProject: t.project.kind === "client",
        recent: recency.has(t.id),
      }));
    options.sort((a, b) => (recency.get(a.id) ?? 1e9) - (recency.get(b.id) ?? 1e9));

    return { tasks: options, categories, lockedWeeks: locks.map((l) => isoDate(l.weekStart)), today };
  });
}

export type EntryView = {
  id: string;
  entryDate: IsoDate;
  minutes: number;
  taskId: string | null;
  taskTitle: string | null;
  projectId: string | null;
  projectCode: string | null;
  categoryId: string | null;
  categoryName: string | null;
  note: string | null;
  isBillable: boolean;
  oosStatus: OosStatus;
  locked: boolean;
  pendingCorrection: boolean;
};

export type CorrectionView = {
  id: string;
  status: "pending" | "approved" | "rejected";
  reason: string;
  reviewNote: string | null;
  createdAt: Date;
  summary: string;
};

/** M3.4 — a user's week, Monday–Sunday, with per-day totals and missing workdays. */
export async function getTimesheet(user: CurrentUser, anyDay: IsoDate) {
  const start = weekStart(anyDay);
  const days = weekDays(start);
  const end = days[6]!;
  const settings = await getSettings();
  const [entries, locked, corrections] = await asUser(user, (tx) =>
    Promise.all([
      tx.timeEntry.findMany({
        where: { userId: user.id, entryDate: { gte: parseIsoDate(start), lte: parseIsoDate(end) } },
        include: {
          task: { select: { title: true } },
          project: { select: { code: true } },
          category: { select: { name: true } },
          corrections: { where: { status: "pending" }, select: { id: true } },
        },
        orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
      }),
      tx.timesheetLock.findUnique({ where: { weekStart: parseIsoDate(start) } }),
      tx.timeCorrection.findMany({
        where: { requestedBy: user.id },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { timeEntry: { select: { entryDate: true } } },
      }),
    ]),
  );

  const today = todayIn(user.timezone);
  const rows: EntryView[] = entries.map((e) => ({
    id: e.id,
    entryDate: isoDate(e.entryDate),
    minutes: e.minutes,
    taskId: e.taskId,
    taskTitle: e.task?.title ?? null,
    projectId: e.projectId,
    projectCode: e.project?.code ?? null,
    categoryId: e.categoryId,
    categoryName: e.category?.name ?? null,
    note: e.note,
    isBillable: e.isBillable,
    oosStatus: e.oosStatus,
    locked: Boolean(locked),
    pendingCorrection: e.corrections.length > 0,
  }));

  return {
    weekStart: start,
    days: days.map((d) => {
      const dayEntries = rows.filter((r) => r.entryDate === d);
      const minutes = dayEntries.reduce((s, e) => s + e.minutes, 0);
      const workday = settings.workdays.includes(isoWeekday(d));
      return { date: d, entries: dayEntries, minutes, workday, missing: workday && minutes === 0 && d <= today };
    }),
    totalMinutes: rows.reduce((s, e) => s + e.minutes, 0),
    locked: Boolean(locked),
    today,
    mustLog: perms.mustLogTime(user),
    corrections: corrections.map((c) => {
      const p = c.proposed as { entryDate?: string; minutes?: number; delete?: boolean };
      return {
        id: c.id,
        status: c.status,
        reason: c.reason,
        reviewNote: c.reviewNote,
        createdAt: c.createdAt,
        summary: p.delete
          ? `Remove entry of ${c.timeEntry ? isoDate(c.timeEntry.entryDate) : "?"}`
          : `${c.timeEntryId ? "Change" : "Add"} ${p.minutes ?? "?"} min on ${p.entryDate ?? "?"}`,
      };
    }),
  };
}

export type Timesheet = Awaited<ReturnType<typeof getTimesheet>>;

/** Is the week of `d` locked? (system read — locks are public). */
export async function isLocked(d: IsoDate): Promise<boolean> {
  return Boolean(await prisma.timesheetLock.findUnique({ where: { weekStart: parseIsoDate(weekStart(d)) } }));
}
