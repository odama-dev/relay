import "server-only";
import type { Prisma, TaskPriority, TaskStatus } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { num } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { isoDate, todayIn } from "@/lib/time/pure";
import { effectiveDue, isOverdueTiming } from "@/lib/tasks/pure";
import { taskTimings, workCalendar } from "@/lib/tasks/timing";

export type TaskPerson = { id: string; name: string; avatarUrl: string | null };

export type TaskRow = {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  sectionId: string;
  sectionName: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  owner: TaskPerson | null;
  collaborators: TaskPerson[];
  position: number;
  /** Past due and not Done (M2.3). */
  overdue: boolean;
  /** The viewer is owner or collaborator. */
  mine: boolean;
};

const rowInclude = {
  project: { select: { code: true, name: true, status: true } },
  section: { select: { name: true } },
  owner: { select: { id: true, fullName: true, avatarUrl: true } },
  collaborators: { include: { user: { select: { id: true, fullName: true, avatarUrl: true } } } },
} satisfies Prisma.TaskInclude;

type RawTask = Prisma.TaskGetPayload<{ include: typeof rowInclude }>;

const person = (p: { id: string; fullName: string; avatarUrl: string | null }): TaskPerson => ({ id: p.id, name: p.fullName, avatarUrl: p.avatarUrl });

function toRow(t: RawTask, viewerId: string, today: string): TaskRow {
  const due = t.dueDate ? isoDate(t.dueDate) : null;
  const collaborators = t.collaborators.map((c) => person(c.user));
  return {
    id: t.id,
    projectId: t.projectId,
    projectCode: t.project.code,
    projectName: t.project.name,
    sectionId: t.sectionId,
    sectionName: t.section.name,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: due,
    owner: t.owner ? person(t.owner) : null,
    collaborators,
    position: t.position,
    overdue: Boolean(due && due < today && t.status !== "done"),
    mine: t.ownerId === viewerId || collaborators.some((c) => c.id === viewerId),
  };
}

export type SectionRow = { id: string; name: string; position: number };

/** M2.3 — sections and their tasks for the list and kanban views. Archived sections hide with their tasks. */
export async function getProjectBoard(user: CurrentUser, projectId: string) {
  const today = todayIn(user.timezone);
  return asUser(user, async (tx) => {
    const [sections, tasks, types, reviewers] = await Promise.all([
      tx.section.findMany({ where: { projectId, archivedAt: null }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
      tx.task.findMany({
        where: { projectId, section: { archivedAt: null } },
        include: rowInclude,
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      }),
      tx.taskType.findMany({ where: { archivedAt: null }, orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, name: true, key: true } }),
      tx.profile.findMany({ where: { status: "active" }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, avatarUrl: true } }),
    ]);
    return {
      sections: sections.map((s) => ({ id: s.id, name: s.name, position: s.position })),
      tasks: tasks.map((t) => toRow(t, user.id, today)),
      types,
      reviewers: reviewers.map(person),
    };
  });
}

/** M2.4 — open tasks where the viewer is owner or collaborator, across projects. */
export async function getMyTasks(user: CurrentUser): Promise<TaskRow[]> {
  const today = todayIn(user.timezone);
  const tasks = await asUser(user, (tx) =>
    tx.task.findMany({
      where: {
        status: { not: "done" },
        section: { archivedAt: null },
        OR: [{ ownerId: user.id }, { collaborators: { some: { userId: user.id } } }],
      },
      include: rowInclude,
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "asc" }, { createdAt: "asc" }],
    }),
  );
  return tasks.map((t) => toRow(t, user.id, today));
}

export type CommentView = {
  id: string;
  author: TaskPerson;
  text: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  mine: boolean;
};

export type ActivityView = { id: string; actor: string; type: string; payload: Record<string, unknown> | null; createdAt: Date };

/** Everything the task panel shows (M2.5–M2.7). Null when the task is gone or not visible. */
export async function getTaskDetail(user: CurrentUser, taskId: string) {
  const data = await asUser(user, async (tx) => {
    const task = await tx.task.findUnique({
      where: { id: taskId },
      include: {
        ...rowInclude,
        project: { select: { id: true, code: true, name: true, kind: true, status: true, pmId: true } },
        comments: {
          orderBy: { createdAt: "asc" },
          include: {
            author: { select: { id: true, fullName: true, avatarUrl: true } },
            deleter: { select: { fullName: true } },
          },
        },
        activity: { orderBy: { createdAt: "asc" }, include: { actor: { select: { fullName: true } } } },
        type: { select: { id: true, name: true, key: true } },
        reviewer: { select: { id: true, fullName: true, avatarUrl: true } },
        reviewRounds: { orderBy: { submittedAt: "desc" }, include: { reviewer: { select: { fullName: true } } } },
        dueChanges: { orderBy: { createdAt: "desc" }, include: { requester: { select: { fullName: true } } } },
      },
    });
    if (!task) return null;
    const [types, studio, timing, calendar] = await Promise.all([
      tx.taskType.findMany({ where: { OR: [{ archivedAt: null }, { id: task.typeId ?? undefined }] }, orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
      tx.profile.findMany({ where: { status: "active" }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, avatarUrl: true } }),
      taskTimings(tx, [task], user.timezone),
      workCalendar(tx),
    ]);
    const [sections, members, canEdit, canManage] = await Promise.all([
      tx.section.findMany({ where: { projectId: task.projectId, archivedAt: null }, orderBy: { position: "asc" }, select: { id: true, name: true } }),
      tx.projectMember.findMany({
        where: { projectId: task.projectId, user: { status: "active" } },
        include: { user: { select: { id: true, fullName: true, avatarUrl: true } } },
      }),
      tx.$queryRaw<{ ok: boolean }[]>`SELECT app.can_edit_task(${taskId}::uuid) AS ok`,
      tx.$queryRaw<{ ok: boolean }[]>`SELECT app.can_manage_project(${task.projectId}::uuid) AS ok`,
    ]);
    return { task, sections, members, types, studio, timing: timing.get(task.id)!, calendar, canEdit: canEdit[0]?.ok ?? false, canManage: canManage[0]?.ok ?? false };
  });
  if (!data) return null;
  const { task } = data;

  // Logged hours on the task — summed over everyone's entries (system read;
  // the viewer already proved access to the task above).
  const logged = await prisma.timeEntry.aggregate({ where: { taskId }, _sum: { minutes: true }, _count: true });
  const today = todayIn(user.timezone);

  const effective = effectiveDue(data.timing, today, data.calendar);
  const missing = [
    !task.dueDate && "due date",
    task.estimateHours === null && "estimate",
    !task.reviewerId && "reviewer",
  ].filter((x): x is string => Boolean(x));

  return {
    ...toRow(task as unknown as RawTask, user.id, today),
    overdue: isOverdueTiming(data.timing, today, data.calendar) || (task.status !== "done" && Boolean(effective && effective < today)),
    description: task.description,
    type: task.type,
    types: data.types,
    reviewer: task.reviewer ? person(task.reviewer) : null,
    /** Everyone active may review — not only project members. */
    reviewers: data.studio.map(person),
    deliverableUrl: task.deliverableUrl,
    originalDueDate: task.originalDueDate ? isoDate(task.originalDueDate) : null,
    effectiveDue: effective,
    approvedAt: task.approvedAt,
    /** Fields PRD Phase 2 requires that this task still lacks. */
    missing,
    reviewRounds: task.reviewRounds.map((r) => ({
      id: r.id,
      reviewer: r.reviewer?.fullName ?? "—",
      submittedAt: r.submittedAt,
      slaDueAt: r.slaDueAt,
      decidedAt: r.decidedAt,
      decision: r.decision,
      note: r.note,
    })),
    dueChanges: task.dueChanges.map((c) => ({
      id: c.id,
      from: c.fromDate ? isoDate(c.fromDate) : null,
      to: isoDate(c.toDate),
      reason: c.reason,
      requester: c.requester?.fullName ?? "—",
      createdAt: c.createdAt,
      state: c.approvedAt ? ("approved" as const) : c.rejectedAt ? ("rejected" as const) : ("pending" as const),
    })),
    estimateHours: num(task.estimateHours),
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    project: { id: task.project.id, code: task.project.code, name: task.project.name, kind: task.project.kind, status: task.project.status },
    loggedMinutes: logged._sum.minutes ?? 0,
    hasTime: logged._count > 0,
    sections: data.sections,
    members: data.members.map((m) => person(m.user)),
    comments: task.comments.map(
      (c): CommentView => ({
        id: c.id,
        author: person(c.author),
        // Deleted comments keep their text in the database, never in the UI (M2.6).
        text: c.deletedAt ? "" : String((c.body as { text?: string })?.text ?? ""),
        createdAt: c.createdAt,
        editedAt: c.editedAt,
        deletedAt: c.deletedAt,
        deletedBy: c.deleter?.fullName ?? null,
        mine: c.authorId === user.id,
      }),
    ),
    activity: task.activity.map(
      (a): ActivityView => ({
        id: a.id,
        actor: a.actor?.fullName ?? "Someone",
        type: a.type,
        payload: (a.payload as Record<string, unknown> | null) ?? null,
        createdAt: a.createdAt,
      }),
    ),
    viewer: {
      canEdit: data.canEdit,
      canManage: data.canManage,
      /** The reviewer — or the PM / C-Level acting for them — decides an open review. */
      canReview: task.status === "review" && (task.reviewerId === user.id || data.canManage),
      canComment: true,
      canDelete: data.canManage && logged._count === 0,
      canLogTime: task.project.status === "active" || task.project.status === "on_hold",
    },
  };
}

export type TaskDetail = NonNullable<Awaited<ReturnType<typeof getTaskDetail>>>;
