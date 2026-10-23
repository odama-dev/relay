import "server-only";
import type { WorkLogKind, WorkLogStatus } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { isoDate, type IsoDate } from "@/lib/time/pure";

export type WorkLogRow = {
  id: string;
  kind: WorkLogKind;
  title: string;
  description: string | null;
  occurredOn: IsoDate;
  person: { id: string; name: string };
  project: { id: string; code: string } | null;
  tags: string[];
  link: string | null;
  hasEvidence: boolean;
  value: number | null;
  total: number | null;
  status: WorkLogStatus;
  reviewNote: string | null;
  reviewer: string | null;
  mine: boolean;
};

const include = {
  user: { select: { id: true, fullName: true } },
  project: { select: { id: true, code: true } },
  reviewer: { select: { fullName: true } },
} as const;

/** Your entries (and ones logged about you), and entries waiting for your review. */
export async function loadWorkLogs(user: CurrentUser) {
  return asUser(user, async (tx) => {
    const reviewable = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM public.work_logs WHERE status = 'submitted' AND app.can_review_log(user_id, project_id) ORDER BY occurred_on DESC LIMIT 200`;
    const [mine, queue, projects, people] = await Promise.all([
      tx.workLog.findMany({ where: { userId: user.id }, include, orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }], take: 300 }),
      tx.workLog.findMany({ where: { id: { in: reviewable.map((r) => r.id) } }, include, orderBy: { occurredOn: "desc" } }),
      tx.project.findMany({ where: { status: { in: ["active", "on_hold", "completed"] } }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
      tx.profile.findMany({ where: { status: "active" }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    ]);
    const row = (l: (typeof mine)[number]): WorkLogRow => ({
      id: l.id,
      kind: l.kind,
      title: l.title,
      description: l.description,
      occurredOn: isoDate(l.occurredOn),
      person: { id: l.user.id, name: l.user.fullName },
      project: l.project,
      tags: l.tags,
      link: l.link,
      hasEvidence: Boolean(l.evidencePath),
      value: l.value == null ? null : Number(l.value),
      total: l.total == null ? null : Number(l.total),
      status: l.status,
      reviewNote: l.reviewNote,
      reviewer: l.reviewer?.fullName ?? null,
      mine: l.userId === user.id,
    });
    return {
      mine: mine.map(row),
      queue: queue.map(row),
      projects: projects.map((p) => ({ id: p.id, label: `${p.code} · ${p.name}` })),
      people: people.map((p) => ({ id: p.id, name: p.fullName })),
    };
  });
}
