"use server";

import { revalidatePath } from "next/cache";
import { asUser, requireUser } from "@/lib/auth";
import { run, fail, parseOrFail, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/audit";
import { perms } from "@/lib/roles";
import { holidaySchema, isoDate, jobRoleSchema, taskTypeSchema, uuid } from "@/lib/validation";
import { parseIsoDate } from "@/lib/time/pure";

/** The People module keeps the job roles, task types and holidays (RLS: has_module('people')). */
async function requirePeopleModule() {
  const user = await requireUser();
  if (!perms.managePeopleModule(user)) fail("Only the People module can change this.");
  return user;
}

const done = () => revalidatePath("/people/setup");

export async function saveJobRole(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePeopleModule();
    const data = parseOrFail(jobRoleSchema, raw);
    const roleId = id == null ? null : parseOrFail(uuid, id);
    const saved = await asUser(user, (tx) =>
      roleId ? tx.jobRole.update({ where: { id: roleId }, data }) : tx.jobRole.create({ data }),
    );
    await logActivity({ actorId: user.id, entityType: "job_role", entityId: saved.id, action: roleId ? "updated" : "created", metadata: data });
    done();
  });
}

export async function setJobRoleArchived(id: unknown, archived: boolean): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePeopleModule();
    const roleId = parseOrFail(uuid, id);
    await asUser(user, (tx) => tx.jobRole.update({ where: { id: roleId }, data: { archivedAt: archived ? new Date() : null } }));
    await logActivity({ actorId: user.id, entityType: "job_role", entityId: roleId, action: archived ? "archived" : "restored" });
    done();
  });
}

/** A stable key from the name, so metrics can filter on it (`content`, `bug`). */
function typeKey(name: string): string {
  const key = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(key) ? key : `type_${key || "custom"}`;
}

export async function addTaskType(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePeopleModule();
    const { name } = parseOrFail(taskTypeSchema, raw);
    const created = await asUser(user, async (tx) => {
      const last = await tx.taskType.aggregate({ _max: { position: true } });
      return tx.taskType.create({ data: { name, key: typeKey(name), position: (last._max.position ?? -1) + 1 } });
    });
    await logActivity({ actorId: user.id, entityType: "task_type", entityId: created.id, action: "created", metadata: { name } });
    done();
  });
}

/** Renaming keeps the key: metrics that filter on it keep working. */
export async function renameTaskType(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePeopleModule();
    const { name } = parseOrFail(taskTypeSchema, raw);
    const typeId = parseOrFail(uuid, id);
    await asUser(user, (tx) => tx.taskType.update({ where: { id: typeId }, data: { name } }));
    await logActivity({ actorId: user.id, entityType: "task_type", entityId: typeId, action: "updated", metadata: { name } });
    done();
  });
}

export async function setTaskTypeArchived(id: unknown, archived: boolean): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePeopleModule();
    const typeId = parseOrFail(uuid, id);
    await asUser(user, (tx) => tx.taskType.update({ where: { id: typeId }, data: { archivedAt: archived ? new Date() : null } }));
    await logActivity({ actorId: user.id, entityType: "task_type", entityId: typeId, action: archived ? "archived" : "restored" });
    done();
  });
}

export async function addHoliday(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePeopleModule();
    const data = parseOrFail(holidaySchema, raw);
    await asUser(user, (tx) => tx.publicHoliday.create({ data: { date: parseIsoDate(data.date), name: data.name } }));
    await logActivity({ actorId: user.id, entityType: "public_holiday", entityId: data.date, action: "created", metadata: { name: data.name } });
    done();
  });
}

export async function deleteHoliday(date: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePeopleModule();
    const iso = parseOrFail(isoDate, date);
    await asUser(user, (tx) => tx.publicHoliday.delete({ where: { date: parseIsoDate(iso) } }));
    await logActivity({ actorId: user.id, entityType: "public_holiday", entityId: iso, action: "deleted" });
    done();
  });
}
