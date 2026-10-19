import "server-only";
import { asUser, type CurrentUser } from "@/lib/auth";
import { isoDate } from "@/lib/time/pure";

export type OosRow = { id: string; date: string; person: string; task: string; project: string; projectId: string; minutes: number; note: string | null };

type Side = { date: string; minutes: number; target: string; note: string | null };
export type CorrectionRow = { id: string; requester: string; project: string; reason: string; createdAt: Date; current: Side | null; proposed: Side | null };

/**
 * What waits for the viewer's decision: out-of-scope work on the projects
 * they run (M4.3) and time corrections they review — the project's PM, or HR
 * for non-billable time (M3.5). Read under RLS. Shared by Approvals and the
 * dashboard (PM-1, HR-2).
 */
export async function getApprovalQueues(user: CurrentUser) {
  const managesProjects = user.role === "c_level" || user.role === "pm";

  const [oos, corrections] = await asUser(user, (tx) =>
    Promise.all([
      managesProjects
        ? tx.timeEntry.findMany({
            where: { oosStatus: "pending", project: user.role === "c_level" ? {} : { pmId: user.id } },
            include: { user: { select: { fullName: true } }, task: { select: { title: true } }, project: { select: { id: true, code: true, name: true } } },
            orderBy: [{ project: { code: "asc" } }, { entryDate: "asc" }],
          })
        : Promise.resolve([]),
      tx.timeCorrection.findMany({
        where: {
          status: "pending",
          OR: [
            ...(user.role === "hr" ? [{ projectId: null }] : []),
            ...(managesProjects ? [{ project: user.role === "c_level" ? {} : { pmId: user.id } }] : []),
          ],
        },
        include: {
          requester: { select: { fullName: true } },
          project: { select: { code: true } },
          timeEntry: { include: { task: { select: { title: true } }, category: { select: { name: true } } } },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]),
  );

  const taskTitles = await asUser(user, async (tx) => {
    const ids = corrections.map((c) => (c.proposed as { taskId?: string }).taskId).filter((x): x is string => Boolean(x));
    const cats = corrections.map((c) => (c.proposed as { categoryId?: string }).categoryId).filter((x): x is string => Boolean(x));
    if (ids.length === 0 && cats.length === 0) return new Map<string, string>();
    const [tasks, categories] = await Promise.all([
      tx.task.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } }),
      tx.workCategory.findMany({ where: { id: { in: cats } }, select: { id: true, name: true } }),
    ]);
    return new Map([...tasks.map((t) => [t.id, t.title] as const), ...categories.map((c) => [c.id, c.name] as const)]);
  });

  const oosRows: OosRow[] = oos.map((e) => ({
    id: e.id,
    date: isoDate(e.entryDate),
    person: e.user.fullName,
    task: e.task?.title ?? "—",
    project: e.project ? `${e.project.code} · ${e.project.name}` : "—",
    projectId: e.project?.id ?? "",
    minutes: e.minutes,
    note: e.note,
  }));
  const correctionRows: CorrectionRow[] = corrections.map((c) => {
    const p = c.proposed as { delete?: boolean; entryDate?: string; minutes?: number; taskId?: string | null; categoryId?: string | null; note?: string | null };
    const e = c.timeEntry;
    return {
      id: c.id,
      requester: c.requester.fullName,
      project: c.project?.code ?? "Non-billable",
      reason: c.reason,
      createdAt: c.createdAt,
      current: e ? { date: isoDate(e.entryDate), minutes: e.minutes, target: e.task?.title ?? e.category?.name ?? "—", note: e.note } : null,
      proposed: p.delete
        ? null
        : { date: p.entryDate ?? "", minutes: p.minutes ?? 0, target: (p.taskId && taskTitles.get(p.taskId)) || (p.categoryId && taskTitles.get(p.categoryId)) || "—", note: p.note ?? null },
    };
  });

  return { managesProjects, oosRows, correctionRows };
}
