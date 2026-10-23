"use server";

import { revalidatePath } from "next/cache";
import type { Prisma, TaskStatus } from "@prisma/client";
import { z } from "zod";
import { asUser, requireUser, type CurrentUser } from "@/lib/auth";
import { run, fail, parseOrFail, type ActionResult } from "@/lib/actions";
import type { Tx } from "@/lib/db";
import { logActivity } from "@/lib/audit";
import { notify, notifyMany } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { isoDate, parseIsoDate } from "@/lib/time/pure";
import { getTaskDetail, type TaskDetail } from "@/lib/tasks/queries";
import { validateTaskContent } from "@/lib/tasks/content";
import { findMentions } from "@/lib/tasks/mentions";
import {
  commentSchema,
  dueChangeDecisionSchema,
  reviewDecisionSchema,
  sectionSchema,
  taskPatchSchema,
  taskSchema,
  TASK_STATUSES,
  uuid,
} from "@/lib/validation";

const taskPath = (projectId: string, taskId: string) => `/projects/${projectId}?task=${taskId}`;

function revalidateTasks(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/my-tasks");
}

async function activity(tx: Tx, user: CurrentUser, taskId: string, type: string, payload?: Prisma.InputJsonValue) {
  await tx.taskActivity.create({ data: { taskId, actorId: user.id, type, payload } });
}

/** Notifies people newly made owner or collaborator (M2.8). */
async function notifyAssigned(user: CurrentUser, task: { id: string; title: string; projectId: string; code: string }, ids: string[], role: "owner" | "collaborator") {
  await notifyMany(
    ids,
    "task_assigned",
    {
      title: `${user.fullName} made you ${role === "owner" ? "owner" : "a collaborator"} of “${task.title}”`,
      body: task.code,
      path: taskPath(task.projectId, task.id),
      refId: task.id,
    },
    user.id,
  );
}

/**
 * Phase 2 review flow notifications: into review → the reviewer; out of
 * review → the owner hears the decision. The database already decided who
 * may move it (tasks_review_flow).
 */
async function notifyReview(user: CurrentUser, taskId: string, from: TaskStatus, to: TaskStatus) {
  if (from === to || (to !== "review" && from !== "review")) return;
  const t = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, title: true, projectId: true, ownerId: true, reviewerId: true, project: { select: { code: true } } },
  });
  if (!t) return;
  const path = taskPath(t.projectId, t.id);
  if (to === "review" && t.reviewerId && t.reviewerId !== user.id) {
    await notify(t.reviewerId, "review_requested", { title: `“${t.title}” is ready for your review`, body: `${t.project.code} · sent by ${user.fullName} · review within 1 working day`, path, refId: t.id });
  } else if (from === "review" && t.ownerId && t.ownerId !== user.id && (to === "done" || to === "in_progress" || to === "todo")) {
    await notify(t.ownerId, "review_decided", {
      title: to === "done" ? `“${t.title}” was approved` : `Changes requested on “${t.title}”`,
      body: `${t.project.code} · by ${user.fullName}`,
      path,
      refId: t.id,
    });
  }
}

/** M2.2 — any member may create a task. */
export async function createTask(projectId: unknown, raw: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await requireUser();
    const pid = parseOrFail(uuid, projectId);
    const d = parseOrFail(taskSchema, raw);
    // PRD Phase 2: a task from the full form has a due date, a reviewer and an
    // estimate. A quick add (title only) is allowed and shows as incomplete.
    const full = Boolean(d.dueDate || d.reviewerId || d.estimateHours !== null || d.typeId);
    if (full) {
      if (!d.dueDate) fail("Set a due date.");
      if (!d.reviewerId) fail("Pick a reviewer.");
      if (d.estimateHours === null) fail("Add an estimate of at least 1 hour.");
    }
    if (d.status === "done") fail("Tasks are approved by their reviewer — create it in another column.");
    const task = await asUser(user, async (tx) => {
      const last = await tx.task.aggregate({ where: { sectionId: d.sectionId }, _max: { position: true } });
      const typeId = d.typeId ?? (await tx.taskType.findUnique({ where: { key: "regular" }, select: { id: true } }))?.id ?? null;
      const t = await tx.task.create({
        data: {
          projectId: pid,
          sectionId: d.sectionId,
          title: d.title,
          ownerId: d.ownerId ?? null,
          priority: d.priority,
          // Review opens a round on the update below.
          status: d.status === "review" ? "in_progress" : d.status,
          dueDate: d.dueDate ? parseIsoDate(d.dueDate) : null,
          estimateHours: d.estimateHours,
          typeId,
          reviewerId: d.reviewerId ?? null,
          deliverableUrl: d.deliverableUrl ?? null,
          position: (last._max.position ?? 0) + 1024,
          createdBy: user.id,
        },
        include: { project: { select: { code: true } } },
      });
      if (d.status === "review") await tx.task.update({ where: { id: t.id }, data: { status: "review" } });
      const collaborators = d.collaboratorIds.filter((id) => id !== d.ownerId);
      if (collaborators.length) await tx.taskCollaborator.createMany({ data: collaborators.map((userId) => ({ taskId: t.id, userId })) });
      await activity(tx, user, t.id, "created");
      return { ...t, collaborators };
    });
    const info = { id: task.id, title: task.title, projectId: pid, code: task.project.code };
    if (task.ownerId) await notifyAssigned(user, info, [task.ownerId], "owner");
    await notifyAssigned(user, info, task.collaborators, "collaborator");
    if (d.status === "review") await notifyReview(user, task.id, "in_progress", "review");
    revalidateTasks(pid);
    return { id: task.id };
  });
}

/**
 * M2.2 / M2.7 — owner, collaborators, the project's PM and C-Level change a
 * task. Every meaningful change lands in the task's activity history.
 */
export async function updateTask(taskId: unknown, raw: unknown): Promise<ActionResult<{ dueRequested: boolean }>> {
  return run(async () => {
    const user = await requireUser();
    const id = parseOrFail(uuid, taskId);
    const patch = parseOrFail(taskPatchSchema, raw);
    const asked = { dueDate: patch.dueDate, reason: patch.dueReason };

    const result = await asUser(user, async (tx) => {
      const before = await tx.task.findUnique({
        where: { id },
        include: { collaborators: { select: { userId: true } }, project: { select: { code: true, pmId: true } } },
      });
      if (!before) fail("This task no longer exists.");

      // A due date that's already set moves only with a reason; the PM's own
      // change is approved at once, anyone else's waits for the PM.
      const beforeDue = before.dueDate ? isoDate(before.dueDate) : null;
      let dueRequested = false;
      if (patch.dueDate !== undefined && beforeDue && patch.dueDate !== beforeDue) {
        if (!patch.dueDate) fail("A due date can't be removed once set.");
        if (!patch.dueReason) fail("Give a reason for the new due date.");
        const change = await tx.dueDateChange.create({ data: { taskId: id, toDate: parseIsoDate(patch.dueDate), reason: patch.dueReason } });
        await activity(tx, user, id, "due_change_requested", { from: beforeDue, to: patch.dueDate, reason: patch.dueReason, approved: Boolean(change.approvedAt) });
        if (!change.approvedAt) {
          dueRequested = true;
          patch.dueDate = undefined;
        }
      }

      const data: Prisma.TaskUncheckedUpdateInput = {};
      if (patch.title !== undefined) data.title = patch.title;
      if (patch.sectionId !== undefined) data.sectionId = patch.sectionId;
      if (patch.ownerId !== undefined) data.ownerId = patch.ownerId;
      if (patch.priority !== undefined) data.priority = patch.priority;
      if (patch.status !== undefined) data.status = patch.status;
      if (patch.dueDate !== undefined) data.dueDate = patch.dueDate ? parseIsoDate(patch.dueDate) : null;
      if (patch.estimateHours !== undefined) data.estimateHours = patch.estimateHours;
      if (patch.typeId !== undefined) data.typeId = patch.typeId;
      if (patch.reviewerId !== undefined) data.reviewerId = patch.reviewerId;
      if (patch.deliverableUrl !== undefined) data.deliverableUrl = patch.deliverableUrl;

      if (Object.keys(data).length) {
        const res = await tx.task.updateMany({ where: { id }, data });
        if (res.count === 0) fail("Only the owner, collaborators, the project's PM or C-Level can change this task.");
      }

      if (patch.status !== undefined && patch.status !== before.status) await activity(tx, user, id, "status_changed", { from: before.status, to: patch.status });
      if (patch.ownerId !== undefined && patch.ownerId !== before.ownerId) await activity(tx, user, id, "owner_changed", { from: before.ownerId, to: patch.ownerId });
      if (patch.dueDate !== undefined && patch.dueDate !== beforeDue) await activity(tx, user, id, "due_date_changed", { from: beforeDue, to: patch.dueDate });
      if (patch.priority !== undefined && patch.priority !== before.priority) await activity(tx, user, id, "priority_changed", { from: before.priority, to: patch.priority });
      if (patch.title !== undefined && patch.title !== before.title) await activity(tx, user, id, "renamed", { from: before.title, to: patch.title });
      if (patch.reviewerId !== undefined && patch.reviewerId !== before.reviewerId) await activity(tx, user, id, "reviewer_changed", { from: before.reviewerId, to: patch.reviewerId });
      if (patch.typeId !== undefined && patch.typeId !== before.typeId) await activity(tx, user, id, "type_changed", { from: before.typeId, to: patch.typeId });

      let addedCollaborators: string[] = [];
      if (patch.collaboratorIds !== undefined) {
        const current = new Set(before.collaborators.map((c) => c.userId));
        const next = new Set(patch.collaboratorIds.filter((u) => u !== (patch.ownerId ?? before.ownerId)));
        addedCollaborators = [...next].filter((u) => !current.has(u));
        const removed = [...current].filter((u) => !next.has(u));
        if (removed.length) await tx.taskCollaborator.deleteMany({ where: { taskId: id, userId: { in: removed } } });
        if (addedCollaborators.length) await tx.taskCollaborator.createMany({ data: addedCollaborators.map((userId) => ({ taskId: id, userId })) });
        if (addedCollaborators.length || removed.length) await activity(tx, user, id, "collaborators_changed", { added: addedCollaborators, removed });
      }
      return { before, addedCollaborators, dueRequested };
    });

    const { before } = result;
    const info = { id, title: patch.title ?? before.title, projectId: before.projectId, code: before.project.code };
    if (patch.ownerId && patch.ownerId !== before.ownerId) await notifyAssigned(user, info, [patch.ownerId], "owner");
    await notifyAssigned(user, info, result.addedCollaborators, "collaborator");
    // Blocked → the project's PM hears about it (M2.8).
    if (patch.status === "blocked" && before.status !== "blocked") {
      await notifyMany([before.project.pmId], "task_blocked", {
        title: `“${info.title}” is blocked`,
        body: `${before.project.code} · marked by ${user.fullName}`,
        path: taskPath(before.projectId, id),
        refId: id,
      }, user.id);
    }
    if (patch.status !== undefined) await notifyReview(user, id, before.status, patch.status);
    if (patch.reviewerId && patch.reviewerId !== before.reviewerId && before.status === "review" && patch.reviewerId !== user.id) {
      await notify(patch.reviewerId, "review_requested", { title: `“${info.title}” is ready for your review`, body: `${info.code} · handed over by ${user.fullName}`, path: taskPath(before.projectId, id), refId: id });
    }
    if (result.dueRequested) {
      await notify(before.project.pmId, "due_change_requested", {
        title: `${user.fullName} asks to move “${info.title}” to ${asked.dueDate ? formatDate(asked.dueDate) : "a new date"}`,
        body: `${info.code} · ${asked.reason ?? ""}`,
        path: taskPath(before.projectId, id),
        refId: id,
      });
    }
    revalidateTasks(before.projectId);
    return { dueRequested: result.dueRequested };
  });
}

/**
 * Drag on the list or kanban (M2.3): a new status and/or section, placed
 * between two neighbours. Positions are fractional, so only this row moves.
 */
export async function moveTask(
  taskId: unknown,
  target: { status?: TaskStatus; sectionId?: string; prevId?: string | null; nextId?: string | null },
): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const id = parseOrFail(uuid, taskId);
    const t = parseOrFail(
      z.object({
        status: z.enum(TASK_STATUSES).optional(),
        sectionId: uuid.optional(),
        prevId: uuid.nullish(),
        nextId: uuid.nullish(),
      }),
      target,
    );
    let moved: TaskStatus | null = null;
    const projectId = await asUser(user, async (tx) => {
      const task = await tx.task.findUnique({ where: { id }, select: { projectId: true, status: true } });
      if (!task) fail("This task no longer exists.");
      const neighbours = await tx.task.findMany({
        where: { id: { in: [t.prevId, t.nextId].filter((x): x is string => Boolean(x)) } },
        select: { id: true, position: true },
      });
      const prev = neighbours.find((n) => n.id === t.prevId)?.position;
      const next = neighbours.find((n) => n.id === t.nextId)?.position;
      const position = prev !== undefined && next !== undefined ? (prev + next) / 2 : prev !== undefined ? prev + 1024 : next !== undefined ? next - 1024 : undefined;

      const data: Prisma.TaskUncheckedUpdateInput = {};
      if (t.status) data.status = t.status;
      if (t.sectionId) data.sectionId = t.sectionId;
      if (position !== undefined) data.position = position;
      const res = await tx.task.updateMany({ where: { id }, data });
      if (res.count === 0) fail("You can't move this task.");
      if (t.status && t.status !== task.status) await activity(tx, user, id, "status_changed", { from: task.status, to: t.status });
      return { projectId: task.projectId, from: task.status };
    }).then((r) => {
      moved = r.from;
      return r.projectId;
    });
    if (t.status && moved) await notifyReview(user, id, moved, t.status);
    if (t.status === "blocked") {
      const p = await asUser(user, (tx) => tx.task.findUnique({ where: { id }, select: { title: true, project: { select: { pmId: true, code: true } } } }));
      if (p) await notifyMany([p.project.pmId], "task_blocked", { title: `“${p.title}” is blocked`, body: `${p.project.code} · marked by ${user.fullName}`, path: taskPath(projectId, id), refId: id }, user.id);
    }
    revalidateTasks(projectId);
  });
}

/** Only the project's PM or C-Level; never a task with logged time (M2.2). */
export async function deleteTask(taskId: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const id = parseOrFail(uuid, taskId);
    const projectId = await asUser(user, async (tx) => {
      const task = await tx.task.findUnique({ where: { id }, select: { projectId: true, _count: { select: { timeEntries: true } } } });
      if (!task) fail("This task no longer exists.");
      if (task._count.timeEntries > 0) fail("This task has logged time, so it can't be deleted. Mark it Done instead.");
      const res = await tx.task.deleteMany({ where: { id } });
      if (res.count === 0) fail("Only the project's PM or C-Level can delete tasks.");
      return task.projectId;
    });
    await logActivity({ actorId: user.id, entityType: "task", entityId: id, action: "deleted", metadata: { projectId } });
    revalidateTasks(projectId);
  });
}

/** M2.5 — rich text stored as validated JSON. */
export async function updateDescription(taskId: unknown, content: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const id = parseOrFail(uuid, taskId);
    const checked = validateTaskContent(content);
    if (!checked.ok) fail(checked.error);
    const res = await asUser(user, (tx) => tx.task.updateMany({ where: { id }, data: { description: checked.value as Prisma.InputJsonValue } }));
    if (res.count === 0) fail("You can't edit this task's description.");
  });
}

export async function loadTask(taskId: unknown): Promise<TaskDetail> {
  const user = await requireUser();
  const id = uuid.safeParse(taskId);
  if (!id.success) throw new Error("Task not found");
  const task = await getTaskDetail(user, id.data);
  if (!task) throw new Error("Task not found");
  return task;
}

// --- Comments (M2.6) ---------------------------------------------------------

export async function addComment(taskId: unknown, raw: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await requireUser();
    const id = parseOrFail(uuid, taskId);
    const { text } = parseOrFail(commentSchema, raw);
    const { comment, task, mentioned } = await asUser(user, async (tx) => {
      const task = await tx.task.findUnique({
        where: { id },
        select: { title: true, projectId: true, ownerId: true, project: { select: { code: true } }, collaborators: { select: { userId: true } } },
      });
      if (!task) fail("This task no longer exists.");
      const members = await tx.projectMember.findMany({ where: { projectId: task.projectId }, include: { user: { select: { id: true, fullName: true } } } });
      const mentioned = findMentions(text, members.map((m) => ({ id: m.user.id, name: m.user.fullName })));
      const comment = await tx.taskComment.create({ data: { taskId: id, authorId: user.id, body: { text, mentions: mentioned } } });
      return { comment, task, mentioned };
    });

    const path = taskPath(task.projectId, id);
    const preview = text.length > 160 ? `${text.slice(0, 157)}…` : text;
    await notifyMany(mentioned, "task_mentioned", { title: `${user.fullName} mentioned you on “${task.title}”`, body: preview, path, refId: comment.id }, user.id);
    // Owner and collaborators hear about new comments — unless the mention already told them.
    await notifyMany(
      [task.ownerId, ...task.collaborators.map((c) => c.userId)].filter((u) => u && !mentioned.includes(u)),
      "task_comment",
      { title: `${user.fullName} commented on “${task.title}”`, body: preview, path, refId: comment.id },
      user.id,
    );
    return { id: comment.id };
  });
}

/** Authors edit their own comments; the edit shows "edited" and lands in the history. */
export async function editComment(commentId: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const id = parseOrFail(uuid, commentId);
    const { text } = parseOrFail(commentSchema, raw);
    await asUser(user, async (tx) => {
      const c = await tx.taskComment.findUnique({ where: { id }, select: { taskId: true, body: true } });
      if (!c) fail("This comment no longer exists.");
      const res = await tx.taskComment.updateMany({ where: { id, authorId: user.id, deletedAt: null }, data: { body: { ...(c.body as object), text } } });
      if (res.count === 0) fail("You can only edit your own comments.");
      await activity(tx, user, c.taskId, "comment_edited", { commentId: id });
    });
  });
}

/** Soft delete: the text stays in the database, the thread shows "deleted by X". */
export async function deleteComment(commentId: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const id = parseOrFail(uuid, commentId);
    await asUser(user, async (tx) => {
      const c = await tx.taskComment.findUnique({ where: { id }, select: { taskId: true } });
      if (!c) fail("This comment no longer exists.");
      const res = await tx.taskComment.updateMany({ where: { id, authorId: user.id, deletedAt: null }, data: { deletedAt: new Date() } });
      if (res.count === 0) fail("You can only delete your own comments.");
      await activity(tx, user, c.taskId, "comment_deleted", { commentId: id });
    });
  });
}

// --- Sections (M2.1) ---------------------------------------------------------

export async function createSection(projectId: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const pid = parseOrFail(uuid, projectId);
    const { name } = parseOrFail(sectionSchema, raw);
    await asUser(user, async (tx) => {
      const last = await tx.section.aggregate({ where: { projectId: pid }, _max: { position: true } });
      await tx.section.create({ data: { projectId: pid, name, position: (last._max.position ?? -1) + 1 } });
    });
    revalidateTasks(pid);
  });
}

export async function renameSection(sectionId: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const id = parseOrFail(uuid, sectionId);
    const { name } = parseOrFail(sectionSchema, raw);
    const s = await asUser(user, async (tx) => {
      const res = await tx.section.updateMany({ where: { id }, data: { name } });
      if (res.count === 0) fail("Only the project's PM or C-Level manage sections.");
      return tx.section.findUniqueOrThrow({ where: { id }, select: { projectId: true } });
    });
    revalidateTasks(s.projectId);
  });
}

export async function moveSection(sectionId: unknown, direction: "up" | "down"): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const id = parseOrFail(uuid, sectionId);
    const projectId = await asUser(user, async (tx) => {
      const s = await tx.section.findUnique({ where: { id }, select: { projectId: true } });
      if (!s) fail("Section not found.");
      const all = await tx.section.findMany({ where: { projectId: s.projectId, archivedAt: null }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
      const i = all.findIndex((x) => x.id === id);
      const j = direction === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= all.length) return s.projectId;
      [all[i], all[j]] = [all[j]!, all[i]!];
      for (const [position, x] of all.entries()) {
        if (x.position !== position) {
          const res = await tx.section.updateMany({ where: { id: x.id }, data: { position } });
          if (res.count === 0) fail("Only the project's PM or C-Level manage sections.");
        }
      }
      return s.projectId;
    });
    revalidateTasks(projectId);
  });
}

/** Archived sections hide with their tasks; logged time still counts (M2.1). */
export async function archiveSection(sectionId: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const id = parseOrFail(uuid, sectionId);
    const projectId = await asUser(user, async (tx) => {
      const s = await tx.section.findUnique({ where: { id }, select: { projectId: true } });
      if (!s) fail("Section not found.");
      const live = await tx.section.count({ where: { projectId: s.projectId, archivedAt: null } });
      if (live <= 1) fail("A project keeps at least one section.");
      const res = await tx.section.updateMany({ where: { id }, data: { archivedAt: new Date() } });
      if (res.count === 0) fail("Only the project's PM or C-Level manage sections.");
      return s.projectId;
    });
    revalidateTasks(projectId);
  });
}

// ---------------------------------------------------------------------------
// Phase 2 — review decisions and due date requests
// ---------------------------------------------------------------------------

/**
 * The reviewer approves (→ Approved) or asks for changes (→ In progress).
 * tasks_review_flow refuses anyone but the reviewer, the project's PM or
 * C-Level, and closes the round; the note is then stored on that round.
 */
export async function reviewTask(taskId: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const id = parseOrFail(uuid, taskId);
    const d = parseOrFail(reviewDecisionSchema, raw);
    if (d.decision === "changes" && !d.note) fail("Say what needs to change.");
    const to: TaskStatus = d.decision === "approve" ? "done" : "in_progress";
    const before = await asUser(user, async (tx) => {
      const t = await tx.task.findUnique({ where: { id }, select: { projectId: true, status: true, deliverableUrl: true, type: { select: { key: true } } } });
      if (!t) fail("This task no longer exists.");
      if (t.status !== "review") fail("This task isn't waiting for review.");
      const res = await tx.task.updateMany({ where: { id }, data: { status: to } });
      if (res.count === 0) fail("Only the reviewer can decide this review.");
      await activity(tx, user, id, "review_decided", { decision: d.decision, note: d.note ?? null });
      return t;
    });
    if (d.note) {
      const round = await prisma.reviewRound.findFirst({ where: { taskId: id, decidedBy: user.id }, orderBy: { decidedAt: "desc" }, select: { id: true } });
      if (round) await prisma.reviewRound.update({ where: { id: round.id }, data: { note: d.note } });
    }
    await logActivity({ actorId: user.id, entityType: "task", entityId: id, action: d.decision === "approve" ? "approved" : "changes_requested" });
    await notifyReview(user, id, "review", to);
    revalidateTasks(before.projectId);
  });
}

/** The project's PM approves or turns down a due date request; approval moves the date in the same transaction. */
export async function decideDueChange(changeId: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const id = parseOrFail(uuid, changeId);
    const d = parseOrFail(dueChangeDecisionSchema, raw);
    const change = await asUser(user, async (tx) => {
      const c = await tx.dueDateChange.findUnique({ where: { id }, include: { task: { select: { id: true, title: true, projectId: true, project: { select: { code: true } } } } } });
      if (!c) fail("This request no longer exists.");
      if (d.approve) {
        await tx.dueDateChange.update({ where: { id }, data: { approvedBy: user.id } });
        await tx.task.update({ where: { id: c.taskId }, data: { dueDate: c.toDate } });
      } else {
        await tx.dueDateChange.update({ where: { id }, data: { rejectedBy: user.id } });
      }
      await activity(tx, user, c.taskId, "due_change_decided", { to: isoDate(c.toDate), approved: d.approve, note: d.note ?? null });
      return c;
    });
    await logActivity({ actorId: user.id, entityType: "due_date_change", entityId: id, action: d.approve ? "approved" : "rejected" });
    if (change.requestedBy && change.requestedBy !== user.id) {
      await notify(change.requestedBy, "due_change_decided", {
        title: `${d.approve ? "New due date approved" : "Due date change turned down"} for “${change.task.title}”`,
        body: `${change.task.project.code} · ${formatDate(isoDate(change.toDate))}${d.note ? ` · ${d.note}` : ""}`,
        path: taskPath(change.task.projectId, change.task.id),
        refId: change.task.id,
      });
    }
    revalidateTasks(change.task.projectId);
  });
}
