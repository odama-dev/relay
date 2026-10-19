"use server";

import { revalidatePath } from "next/cache";
import { asUser, requireUser } from "@/lib/auth";
import { run, fail, parseOrFail, type ActionResult } from "@/lib/actions";
import { prisma } from "@/lib/prisma";
import { notifyMany } from "@/lib/notify";
import { checkBudgetAlerts } from "@/lib/health/alerts";
import { logTimeOptions, isLocked, type LogTimeOptions } from "@/lib/time/queries";
import { parseIsoDate } from "@/lib/time/pure";
import { formatDuration } from "@/lib/format";
import { correctionSchema, timeEntrySchema, uuid } from "@/lib/validation";

export async function getLogTimeOptions(): Promise<LogTimeOptions> {
  return logTimeOptions(await requireUser());
}

function revalidateTime(projectIds: (string | null | undefined)[]) {
  revalidatePath("/timesheet");
  revalidatePath("/my-tasks");
  for (const id of projectIds) if (id) revalidatePath(`/projects/${id}`);
}

/**
 * M3.1 — log time to a task or a non-billable category. Billable, project and
 * the lock / membership / status rules are enforced by the database trigger.
 */
export async function logTime(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(timeEntrySchema, raw);
    const entry = await asUser(user, (tx) =>
      tx.timeEntry.create({
        data: {
          userId: user.id,
          entryDate: parseIsoDate(d.entryDate),
          minutes: d.minutes,
          taskId: d.taskId ?? null,
          categoryId: d.categoryId ?? null,
          note: d.note ?? null,
          oosStatus: d.outOfScope ? "pending" : "none",
        },
      }),
    );
    await checkBudgetAlerts(entry.projectId ? [entry.projectId] : []);
    revalidateTime([entry.projectId]);
    return { id: entry.id };
  });
}

/** M3.4 — the owner edits entries of unlocked weeks. */
export async function updateEntry(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const entryId = parseOrFail(uuid, id);
    const d = parseOrFail(timeEntrySchema, raw);
    const { before, after } = await asUser(user, async (tx) => {
      const before = await tx.timeEntry.findFirst({ where: { id: entryId, userId: user.id } });
      if (!before) fail("This entry no longer exists.");
      // Keep a reviewed out-of-scope decision unless the flag is switched off.
      const oosStatus = d.outOfScope ? (before.oosStatus === "none" || before.oosStatus === "rejected" ? "pending" : before.oosStatus) : "none";
      if (oosStatus !== before.oosStatus && (before.oosStatus === "approved")) fail("This entry was approved as out of scope. Ask the PM before changing it.");
      const after = await tx.timeEntry.update({
        where: { id: entryId },
        data: {
          entryDate: parseIsoDate(d.entryDate),
          minutes: d.minutes,
          taskId: d.taskId ?? null,
          categoryId: d.categoryId ?? null,
          note: d.note ?? null,
          oosStatus,
        },
      });
      return { before, after };
    });
    await checkBudgetAlerts([before.projectId, after.projectId].filter((x): x is string => Boolean(x)));
    revalidateTime([before.projectId, after.projectId]);
  });
}

export async function deleteEntry(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const entryId = parseOrFail(uuid, id);
    const projectId = await asUser(user, async (tx) => {
      const e = await tx.timeEntry.findFirst({ where: { id: entryId, userId: user.id }, select: { projectId: true } });
      if (!e) fail("This entry no longer exists.");
      await tx.timeEntry.delete({ where: { id: entryId } });
      return e.projectId;
    });
    await checkBudgetAlerts(projectId ? [projectId] : []);
    revalidateTime([projectId]);
  });
}

/**
 * M3.5 — after a week is locked, changes go through a correction: change or
 * remove an entry, or add a forgotten one. Project entries are reviewed by
 * the project's PM, category entries by HR.
 */
export async function requestCorrection(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(correctionSchema, raw);
    if (!d.timeEntryId && d.delete) fail("Choose the entry to remove.");
    if (!d.timeEntryId && !(await isLocked(d.entryDate))) fail("This week isn't locked — log the time directly.");

    const correction = await asUser(user, async (tx) => {
      if (d.timeEntryId) {
        const pending = await tx.timeCorrection.count({ where: { timeEntryId: d.timeEntryId, status: "pending" } });
        if (pending) fail("This entry already has a correction waiting for review.");
      }
      return tx.timeCorrection.create({
        data: {
          timeEntryId: d.timeEntryId ?? null,
          requestedBy: user.id,
          reason: d.reason,
          proposed: d.delete
            ? { delete: true }
            : { entryDate: d.entryDate, minutes: d.minutes, taskId: d.taskId ?? null, categoryId: d.categoryId ?? null, note: d.note ?? null },
        },
      });
    });

    // Reviewer: the project's PM, or every HR user for non-billable time.
    const reviewers = correction.projectId
      ? [(await prisma.project.findUnique({ where: { id: correction.projectId }, select: { pmId: true } }))?.pmId]
      : (await prisma.profile.findMany({ where: { role: "hr", status: "active" }, select: { id: true } })).map((p) => p.id);
    await notifyMany(reviewers, "correction_requested", {
      title: `${user.fullName} asked for a time correction`,
      body: `${d.delete ? "Remove an entry" : `${formatDuration(d.minutes)} on ${d.entryDate}`} — ${d.reason}`,
      path: "/approvals?tab=corrections",
      refId: correction.id,
    }, user.id);
    revalidatePath("/timesheet");
    revalidatePath("/approvals");
  });
}
