"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser, requireUser } from "@/lib/auth";
import { run, fail, parseOrFail, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { notifyMany } from "@/lib/notify";
import { checkBudgetAlerts } from "@/lib/health/alerts";
import { parseIsoDate } from "@/lib/time/pure";
import { formatDuration } from "@/lib/format";
import { reviewSchema, uuid } from "@/lib/validation";

/**
 * M4.3 — approve (→ change request, out of the budget) or reject (→ counted
 * as in-scope work). Bulk. Only the project's PM or C-Level (trigger-enforced).
 */
export async function reviewOutOfScope(raw: unknown): Promise<ActionResult<{ count: number }>> {
  return run(async () => {
    const user = await requireUser();
    const { ids, decision, note } = parseOrFail(reviewSchema, raw);
    const entries = await asUser(user, async (tx) => {
      const rows = await tx.timeEntry.findMany({
        where: { id: { in: ids }, oosStatus: "pending" },
        select: { id: true, userId: true, projectId: true, minutes: true, entryDate: true, task: { select: { title: true } } },
      });
      for (const e of rows) {
        // Through the trigger: only the project's PM / C-Level may set this.
        await tx.timeEntry.update({ where: { id: e.id }, data: { oosStatus: decision, oosNote: note ?? null } });
      }
      return rows;
    });
    if (entries.length === 0) fail("Nothing to review — these entries were already decided.");

    for (const e of entries) {
      await notifyMany([e.userId], "oos_decided", {
        title: `Out-of-scope ${decision === "approved" ? "approved" : "rejected"}: ${e.task?.title ?? "time entry"}`,
        body: `${formatDuration(e.minutes)} on ${e.entryDate.toISOString().slice(0, 10)}${note ? ` — ${note}` : ""}${decision === "rejected" ? " · counted as in-scope work" : " · listed as a change request"}`,
        path: "/timesheet",
        refId: e.id,
      }, user.id);
    }
    await checkBudgetAlerts([...new Set(entries.map((e) => e.projectId).filter((x): x is string => Boolean(x)))]);
    await logActivity({ actorId: user.id, entityType: "time_entry", entityId: ids[0]!, action: `oos_${decision}`, metadata: { count: entries.length } });
    revalidatePath("/approvals");
    for (const p of new Set(entries.map((e) => e.projectId))) if (p) revalidatePath(`/projects/${p}`);
    return { count: entries.length };
  });
}

/** M4.4 (optional) — mark approved out-of-scope work as invoiced to the client. */
export async function markChangeRequestsBilled(ids: unknown, billed: boolean): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const list = parseOrFail(z.array(uuid).min(1).max(500), ids);
    const res = await asUser(user, (tx) =>
      tx.timeEntry.updateMany({ where: { id: { in: list }, oosStatus: "approved" }, data: { billedAt: billed ? new Date() : null } }),
    );
    if (res.count === 0) fail("Only the project's PM or C-Level can do this.");
    revalidatePath("/projects", "layout");
  });
}

/**
 * M3.5 — approve or reject a correction. Approval applies the change on the
 * system connection (the week is locked for everyone else) and records who
 * approved; rejection notifies the requester with the reason.
 */
export async function reviewCorrection(id: unknown, decision: "approved" | "rejected", note?: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const correctionId = parseOrFail(uuid, id);
    parseOrFail(z.enum(["approved", "rejected"]), decision);
    if (decision === "rejected" && !note?.trim()) fail("Give the reason for rejecting.");

    // The RLS update proves this user is the reviewer (project PM, or HR for categories).
    const correction = await asUser(user, async (tx) => {
      const res = await tx.timeCorrection.updateMany({ where: { id: correctionId, status: "pending" }, data: { status: decision, reviewNote: note?.trim() || null } });
      if (res.count === 0) fail("You can't review this correction, or it was already reviewed.");
      return tx.timeCorrection.findUniqueOrThrow({ where: { id: correctionId } });
    });

    let projectIds: string[] = [];
    if (decision === "approved") {
      projectIds = await applyCorrection(correction);
    }
    await notifyMany([correction.requestedBy], "correction_decided", {
      title: `Your time correction was ${decision}`,
      body: note?.trim() ? `${user.fullName}: ${note.trim()}` : `Reviewed by ${user.fullName}`,
      path: "/timesheet",
      refId: correction.id,
    });
    await checkBudgetAlerts(projectIds);
    await logActivity({ actorId: user.id, entityType: "time_correction", entityId: correction.id, action: decision });
    revalidatePath("/approvals");
    revalidatePath("/timesheet");
  });
}

type Proposed = { delete?: boolean; entryDate?: string; minutes?: number; taskId?: string | null; categoryId?: string | null; note?: string | null };

async function applyCorrection(c: { id: string; timeEntryId: string | null; requestedBy: string; proposed: unknown }): Promise<string[]> {
  const p = c.proposed as Proposed;
  const touched: string[] = [];
  await prisma.$transaction(async (tx) => {
    if (c.timeEntryId) {
      const before = await tx.timeEntry.findUnique({ where: { id: c.timeEntryId } });
      if (!before) return;
      if (before.projectId) touched.push(before.projectId);
      if (p.delete) {
        await tx.timeEntry.delete({ where: { id: c.timeEntryId } });
        return;
      }
      const after = await tx.timeEntry.update({
        where: { id: c.timeEntryId },
        data: {
          entryDate: p.entryDate ? parseIsoDate(p.entryDate) : undefined,
          minutes: p.minutes,
          taskId: p.taskId ?? null,
          categoryId: p.categoryId ?? null,
          note: p.note ?? null,
        },
      });
      if (after.projectId) touched.push(after.projectId);
    } else if (p.entryDate && p.minutes) {
      const created = await tx.timeEntry.create({
        data: {
          userId: c.requestedBy,
          entryDate: parseIsoDate(p.entryDate),
          minutes: p.minutes,
          taskId: p.taskId ?? null,
          categoryId: p.categoryId ?? null,
          note: p.note ?? null,
        },
      });
      await tx.timeCorrection.update({ where: { id: c.id }, data: { timeEntryId: created.id } });
      if (created.projectId) touched.push(created.projectId);
    }
  });
  return touched;
}
