"use server";

import { revalidatePath } from "next/cache";
import { asUser, requireUser } from "@/lib/auth";
import { fail, parseOrFail, run, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/audit";
import { notify, notifyMany } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { objectionDecisionSchema, objectionSchema, uuid } from "@/lib/validation";

/** PRD "Keberatan": your own recorded result, within 7 days (kpi_objections_guard). */
export async function fileObjection(resultId: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const id = parseOrFail(uuid, resultId);
    const d = parseOrFail(objectionSchema, raw);
    const row = await asUser(user, (tx) => tx.kpiObjection.create({ data: { resultId: id, metricKey: d.metricKey ?? null, reason: d.reason, createdBy: user.id } }));
    await logActivity({ actorId: user.id, entityType: "kpi_objection", entityId: row.id, action: "created" });
    // HR decides with the direct manager: both hear about it.
    const [people, me] = await Promise.all([
      prisma.moduleGrant.findMany({ where: { module: "people", user: { status: "active" } }, select: { userId: true } }),
      prisma.profile.findUnique({ where: { id: user.id }, select: { managerId: true } }),
    ]);
    await notifyMany(
      [...new Set([...people.map((p) => p.userId), ...(me?.managerId ? [me.managerId] : [])])],
      "kpi_objection",
      { title: `${user.fullName} objected to a KPI result`, body: d.reason.slice(0, 140), path: `/kpi?person=${user.id}`, refId: row.id },
      user.id,
    );
    revalidatePath("/kpi");
  });
}

export async function decideObjection(objectionId: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const id = parseOrFail(uuid, objectionId);
    const d = parseOrFail(objectionDecisionSchema, raw);
    const row = await asUser(user, async (tx) => {
      const res = await tx.kpiObjection.updateMany({ where: { id }, data: { status: d.upheld ? "upheld" : "rejected", decisionNote: d.note } });
      if (res.count === 0) fail("Only the People module decides objections.");
      return tx.kpiObjection.findUniqueOrThrow({ where: { id }, select: { createdBy: true } });
    });
    await logActivity({ actorId: user.id, entityType: "kpi_objection", entityId: id, action: d.upheld ? "upheld" : "rejected" });
    await notify(row.createdBy, "kpi_objection_decided", { title: d.upheld ? "Your KPI objection was upheld" : "Your KPI objection was turned down", body: d.note, path: "/kpi", refId: id });
    revalidatePath("/kpi");
  });
}
