"use server";

import { revalidatePath } from "next/cache";
import { asUser, requireUser } from "@/lib/auth";
import { fail, parseOrFail, run, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/audit";
import { notify, notifyMany } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { hasModule } from "@/lib/roles";
import { monthStart, parseIsoDate } from "@/lib/time/pure";
import { keyResultSchema, krCheckinSchema, objectiveSchema, okrCycleSchema, uuid } from "@/lib/validation";

const done = () => revalidatePath("/okr");

/**
 * PRD "OKR": members write their own, managers propose for their team, the
 * People module approves; studio objectives come from Studio Report
 * (objectives_guard decides the status).
 */
export async function createObjective(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(objectiveSchema, raw);
    const row = await asUser(user, async (tx) => {
      const o = await tx.objective.create({
        data: { cycleId: d.cycleId, title: d.title, description: d.description ?? null, isStudio: d.isStudio, parentId: d.parentId ?? null },
      });
      await tx.objectiveOwner.createMany({ data: [...new Set(d.ownerIds)].map((userId) => ({ objectiveId: o.id, userId })) });
      return o;
    });
    await logActivity({ actorId: user.id, entityType: "objective", entityId: row.id, action: "created", metadata: { title: d.title, status: row.status } });
    if (row.status === "proposed") {
      const people = await prisma.moduleGrant.findMany({ where: { module: "people", user: { status: "active" } }, select: { userId: true } });
      await notifyMany(people.map((p) => p.userId), "okr_proposed", { title: `${user.fullName} proposed an objective: ${d.title}`, body: "Approve it in OKR.", path: "/okr?tab=approve", refId: row.id }, user.id);
    }
    done();
    return { id: row.id };
  });
}

export async function updateObjective(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const oid = parseOrFail(uuid, id);
    const d = parseOrFail(objectiveSchema, raw);
    await asUser(user, async (tx) => {
      const res = await tx.objective.updateMany({ where: { id: oid }, data: { title: d.title, description: d.description ?? null, parentId: d.parentId ?? null } });
      if (res.count === 0) fail("You can't change this objective.");
      await tx.objectiveOwner.deleteMany({ where: { objectiveId: oid, userId: { notIn: d.ownerIds } } });
      await tx.objectiveOwner.createMany({ data: d.ownerIds.map((userId) => ({ objectiveId: oid, userId })), skipDuplicates: true });
    });
    await logActivity({ actorId: user.id, entityType: "objective", entityId: oid, action: "updated", metadata: { title: d.title } });
    done();
  });
}

export async function setObjectiveStatus(id: unknown, status: "approved" | "archived"): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const oid = parseOrFail(uuid, id);
    const row = await asUser(user, async (tx) => {
      const res = await tx.objective.updateMany({ where: { id: oid }, data: { status } });
      if (res.count === 0) fail("You can't change this objective.");
      return tx.objective.findUniqueOrThrow({ where: { id: oid }, select: { title: true, proposedBy: true } });
    });
    await logActivity({ actorId: user.id, entityType: "objective", entityId: oid, action: status });
    if (status === "approved" && row.proposedBy && row.proposedBy !== user.id) {
      await notify(row.proposedBy, "okr_decided", { title: `Objective approved: ${row.title}`, body: `by ${user.fullName}`, path: "/okr", refId: oid });
    }
    done();
  });
}

export async function deleteObjective(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const oid = parseOrFail(uuid, id);
    const res = await asUser(user, (tx) => tx.objective.deleteMany({ where: { id: oid } }));
    if (res.count === 0) fail("Only a proposed objective of yours (or the People module) can be deleted.");
    await logActivity({ actorId: user.id, entityType: "objective", entityId: oid, action: "deleted" });
    done();
  });
}

export async function saveKeyResult(objectiveId: unknown, keyResultId: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const oid = parseOrFail(uuid, objectiveId);
    const kid = keyResultId == null ? null : parseOrFail(uuid, keyResultId);
    const d = parseOrFail(keyResultSchema, raw);
    const data = {
      title: d.title,
      kind: d.kind,
      source: d.kind === "kpi_linked" ? ("metric" as const) : d.source,
      metricId: d.metricId ?? null,
      startValue: d.startValue,
      targetValue: d.kind === "milestone" ? null : d.targetValue,
      unit: d.unit,
      doneDefinition: d.doneDefinition ?? null,
      approverId: d.approverId ?? null,
    };
    const id = await asUser(user, async (tx) => {
      const k = kid
        ? await tx.keyResult.update({ where: { id: kid }, data })
        : await tx.keyResult.create({ data: { ...data, objectiveId: oid, position: await tx.keyResult.count({ where: { objectiveId: oid } }) } });
      if (data.source === "tasks") {
        await tx.krLink.deleteMany({ where: { keyResultId: k.id, taskId: { notIn: d.taskIds } } });
        await tx.krLink.createMany({ data: d.taskIds.map((taskId) => ({ keyResultId: k.id, taskId })), skipDuplicates: true });
      }
      return k.id;
    });
    await logActivity({ actorId: user.id, entityType: "key_result", entityId: id, action: kid ? "updated" : "created", metadata: { title: d.title, kind: d.kind } });
    done();
  });
}

export async function deleteKeyResult(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const kid = parseOrFail(uuid, id);
    const res = await asUser(user, (tx) => tx.keyResult.deleteMany({ where: { id: kid } }));
    if (res.count === 0) fail("You can't change this key result.");
    await logActivity({ actorId: user.id, entityType: "key_result", entityId: kid, action: "deleted" });
    done();
  });
}

/** Monthly check-in by an owner (value, note, evidence). */
export async function checkInKeyResult(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const kid = parseOrFail(uuid, id);
    const d = parseOrFail(krCheckinSchema, raw);
    const month = parseIsoDate(monthStart(d.month));
    await asUser(user, (tx) =>
      tx.krCheckin.upsert({
        where: { keyResultId_month: { keyResultId: kid, month } },
        create: { keyResultId: kid, month, value: d.value, note: d.note ?? null, evidenceUrl: d.evidenceUrl ?? null },
        update: { value: d.value, note: d.note ?? null, evidenceUrl: d.evidenceUrl ?? null },
      }),
    );
    await logActivity({ actorId: user.id, entityType: "key_result", entityId: kid, action: "checked_in", metadata: { month: d.month, value: d.value } });
    done();
  });
}

/** Owners mark a milestone done; its approver (the direct manager) confirms. */
export async function setMilestone(id: unknown, step: "done" | "undo" | "confirm"): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const kid = parseOrFail(uuid, id);
    const k = await asUser(user, async (tx) => {
      const data = step === "done" ? { doneAt: new Date() } : step === "undo" ? { doneAt: null, doneApprovedBy: null } : { doneApprovedBy: user.id };
      await tx.keyResult.update({ where: { id: kid }, data });
      return tx.keyResult.findUniqueOrThrow({ where: { id: kid }, select: { title: true, approverId: true } });
    });
    await logActivity({ actorId: user.id, entityType: "key_result", entityId: kid, action: `milestone_${step}` });
    if (step === "done" && k.approverId && k.approverId !== user.id) {
      await notify(k.approverId, "okr_decided", { title: `Milestone to confirm: ${k.title}`, body: `marked done by ${user.fullName}`, path: "/okr", refId: kid });
    }
    done();
  });
}

export async function saveCycle(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    if (!hasModule(user, "people", "studio_report")) fail("Only People or Studio Report manage OKR cycles.");
    const d = parseOrFail(okrCycleSchema, raw);
    if (d.endDate <= d.startDate) fail("The cycle must end after it starts.");
    const cid = id == null ? null : parseOrFail(uuid, id);
    const data = { name: d.name, startDate: parseIsoDate(d.startDate), endDate: parseIsoDate(d.endDate), status: d.status };
    const row = await asUser(user, (tx) => (cid ? tx.okrCycle.update({ where: { id: cid }, data }) : tx.okrCycle.create({ data })));
    await logActivity({ actorId: user.id, entityType: "okr_cycle", entityId: row.id, action: cid ? "updated" : "created", metadata: { name: d.name } });
    done();
    revalidatePath("/performance");
  });
}
