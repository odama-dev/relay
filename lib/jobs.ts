import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { alreadyNotified, notify } from "@/lib/notify";
import { checkBudgetAlerts } from "@/lib/health/alerts";
import { freezeRetainerMonths } from "@/lib/health/queries";
import { checkOverdueInvoices } from "@/lib/invoices/payments";
import { addDays, isoWeekday, parseIsoDate, todayIn, weekStart } from "@/lib/time/pure";
import { formatDuration } from "@/lib/format";

/**
 * Scheduled jobs (PRD "Job terjadwal", WIB). The VPS cron calls
 * /api/cron/<job> at the listed times. Every job is safe to run again
 * (idempotent) and logs its result in `job_runs`.
 */

const STUDIO_TZ = "Asia/Jakarta";
const startOfToday = () => new Date(new Date(`${todayIn(STUDIO_TZ)}T00:00:00+07:00`).getTime());

/** 09:00 daily — tasks due tomorrow, to their owner (M2.8). */
async function dueReminders() {
  const tomorrow = addDays(todayIn(STUDIO_TZ), 1);
  const tasks = await prisma.task.findMany({
    where: { dueDate: parseIsoDate(tomorrow), status: { not: "done" }, ownerId: { not: null }, section: { archivedAt: null }, project: { status: { in: ["active", "on_hold"] } } },
    select: { id: true, title: true, ownerId: true, projectId: true, project: { select: { code: true } } },
  });
  let sent = 0;
  for (const t of tasks) {
    if (await alreadyNotified(t.ownerId!, "task_due_tomorrow", t.id, startOfToday())) continue;
    await notify(t.ownerId!, "task_due_tomorrow", { title: `Due tomorrow: ${t.title}`, body: t.project.code, path: `/projects/${t.projectId}?task=${t.id}`, refId: t.id });
    sent++;
  }
  return { tasks: tasks.length, sent };
}

/** Workdays at the reminder time (17:00) — everyone required to log who hasn't today (M3.6). */
async function timeReminders() {
  const settings = await getSettings();
  const today = todayIn(STUDIO_TZ);
  if (!settings.workdays.includes(isoWeekday(today))) return { skipped: "not a workday" };
  const people = await prisma.profile.findMany({
    where: { status: "active", role: { not: "c_level" }, timeEntries: { none: { entryDate: parseIsoDate(today) } } },
    select: { id: true },
  });
  let sent = 0;
  for (const p of people) {
    if (await alreadyNotified(p.id, "time_reminder", today, startOfToday())) continue;
    await notify(p.id, "time_reminder", {
      title: "You haven't logged time today",
      body: "Takes 15 seconds — log it before you forget.",
      path: "/timesheet?create=1",
      refId: today,
    });
    sent++;
  }
  return { missing: people.length, sent };
}

/** 17:30 daily — one summary per project of new out-of-scope entries, to its PM (M4.3). */
async function oosDigest() {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const today = todayIn(STUDIO_TZ);
  const fresh = await prisma.timeEntry.groupBy({
    by: ["projectId"],
    where: { oosStatus: "pending", createdAt: { gte: since }, projectId: { not: null } },
    _count: true,
    _sum: { minutes: true },
  });
  let sent = 0;
  for (const g of fresh) {
    const project = await prisma.project.findUnique({ where: { id: g.projectId! }, select: { pmId: true, code: true, name: true } });
    if (!project) continue;
    const refId = `${g.projectId}:${today}`;
    if (await alreadyNotified(project.pmId, "oos_digest", refId, startOfToday())) continue;
    const waiting = await prisma.timeEntry.count({ where: { projectId: g.projectId, oosStatus: "pending" } });
    await notify(project.pmId, "oos_digest", {
      title: `${g._count} new out-of-scope ${g._count === 1 ? "entry" : "entries"} on ${project.code}`,
      body: `${formatDuration(g._sum.minutes ?? 0)} flagged today on ${project.name}. ${waiting} waiting for your decision.`,
      path: "/approvals",
      refId,
    });
    sent++;
  }
  return { projects: fresh.length, sent };
}

/** Monday 00:00 — lock the previous week (M3.5). */
async function lockTimesheets() {
  const previous = addDays(weekStart(todayIn(STUDIO_TZ)), -7);
  const lock = await prisma.timesheetLock.upsert({ where: { weekStart: parseIsoDate(previous) }, create: { weekStart: parseIsoDate(previous) }, update: {} });
  return { locked: previous, at: lock.lockedAt };
}

/** 1st of the month 00:05 — freeze last month's retainer settings, re-check alerts for the new period. */
async function retainerRollover() {
  const retainers = await prisma.project.findMany({ where: { contractType: "retainer", status: { in: ["active", "on_hold"] } }, select: { id: true } });
  let frozen = 0;
  for (const p of retainers) frozen += await freezeRetainerMonths(p.id);
  const alerts = await checkBudgetAlerts(retainers.map((p) => p.id));
  return { projects: retainers.length, frozenMonths: frozen, alerts: alerts.sent };
}

/** 00:10 daily — invoice statuses, overdue DMs (M5.8). */
async function overdueInvoices() {
  return checkOverdueInvoices(todayIn(STUDIO_TZ));
}

/** Hourly safety net — budget thresholds for every open project (M4.2). */
async function budgetAlerts() {
  const projects = await prisma.project.findMany({ where: { status: { in: ["active", "on_hold"] } }, select: { id: true } });
  return checkBudgetAlerts(projects.map((p) => p.id));
}

export const JOBS = {
  "due-reminders": dueReminders,
  "time-reminders": timeReminders,
  "oos-digest": oosDigest,
  "lock-timesheets": lockTimesheets,
  "retainer-rollover": retainerRollover,
  "overdue-invoices": overdueInvoices,
  "budget-alerts": budgetAlerts,
} as const;

export type JobName = keyof typeof JOBS;

export async function runJob(name: JobName): Promise<{ ok: boolean; result: unknown }> {
  const run = await prisma.jobRun.create({ data: { job: name } });
  try {
    const result = await JOBS[name]();
    await prisma.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: true, result: result as Prisma.InputJsonValue } });
    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, result: { error: message } } });
    console.error(`[job:${name}]`, err);
    return { ok: false, result: { error: message } };
  }
}

