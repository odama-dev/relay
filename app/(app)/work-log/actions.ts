"use server";

import { revalidatePath } from "next/cache";
import { asUser, requireUser } from "@/lib/auth";
import { fail, parseOrFail, run, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { LOG_KINDS } from "@/lib/kpi/logs";
import { parseIsoDate } from "@/lib/time/pure";
import { uuid, workLogReviewSchema, workLogSchema } from "@/lib/validation";

/** Log a shot, idea, error… for yourself, or (manager / PM / People) for someone else. */
export async function createWorkLog(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(workLogSchema, raw);
    const cfg = LOG_KINDS[d.kind];
    if (cfg.linkRequired && !d.link) fail(`Add the ${cfg.linkLabel?.toLowerCase() ?? "link"}.`);
    if (cfg.tags && !d.tag) fail("Pick a category.");
    if (d.kind === "error" && !d.link) fail("An error needs evidence — add a link (or attach a file after saving).");
    if (d.kind === "testimony" && !d.projectId) fail("Pick the project.");
    const subject = d.userId ?? user.id;
    const row = await asUser(user, (tx) =>
      tx.workLog.create({
        data: {
          kind: d.kind,
          userId: subject,
          projectId: d.projectId ?? null,
          taskId: d.taskId ?? null,
          occurredOn: parseIsoDate(d.occurredOn),
          title: d.title,
          description: d.description ?? null,
          tags: d.tag ? [d.tag] : [],
          link: d.link ?? null,
          value: d.value,
          total: d.total,
        },
      }),
    );
    await logActivity({ actorId: user.id, entityType: "work_log", entityId: row.id, action: "created", metadata: { kind: d.kind, subject } });
    // The direct manager reviews (an idea, a shot…); someone else's entry is shown to them.
    const target = subject === user.id ? (await prisma.profile.findUnique({ where: { id: user.id }, select: { managerId: true } }))?.managerId : subject;
    if (target && target !== user.id) {
      await notify(target, "log_review", {
        title: subject === user.id ? `${user.fullName} logged ${cfg.label.toLowerCase()}: ${d.title}` : `${user.fullName} logged ${cfg.label.toLowerCase()} about you: ${d.title}`,
        body: subject === user.id ? "Review it in Work Log." : "You can see it in Work Log.",
        path: subject === user.id ? "/work-log?tab=review" : "/work-log",
        refId: row.id,
      });
    }
    revalidatePath("/work-log");
    return { id: row.id };
  });
}

/** Approve or reject (work_logs_guard: their manager, the project's PM, People, C-Level — never your own). */
export async function reviewWorkLog(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const logId = parseOrFail(uuid, id);
    const d = parseOrFail(workLogReviewSchema, raw);
    if (!d.approve && !d.note) fail("Say why it's rejected.");
    const row = await asUser(user, async (tx) => {
      const res = await tx.workLog.updateMany({
        where: { id: logId, status: "submitted" },
        data: { status: d.approve ? "approved" : "rejected", reviewNote: d.note ?? null, ...(d.value !== null ? { value: d.value } : {}) },
      });
      if (res.count === 0) fail("This entry was already reviewed, or you can't review it.");
      return tx.workLog.findUniqueOrThrow({ where: { id: logId }, select: { userId: true, title: true, kind: true } });
    });
    await logActivity({ actorId: user.id, entityType: "work_log", entityId: logId, action: d.approve ? "approved" : "rejected" });
    await notify(row.userId, "log_decided", {
      title: `${LOG_KINDS[row.kind].label} ${d.approve ? "approved" : "rejected"}: ${row.title}`,
      body: d.note ?? `by ${user.fullName}`,
      path: "/work-log",
      refId: logId,
    });
    revalidatePath("/work-log");
  });
}

export async function deleteWorkLog(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const logId = parseOrFail(uuid, id);
    const res = await asUser(user, (tx) => tx.workLog.deleteMany({ where: { id: logId } }));
    if (res.count === 0) fail("Only a submitted entry of yours can be deleted.");
    await logActivity({ actorId: user.id, entityType: "work_log", entityId: logId, action: "deleted" });
    revalidatePath("/work-log");
  });
}
