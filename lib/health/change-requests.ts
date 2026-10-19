import "server-only";
import { asUser, type CurrentUser } from "@/lib/auth";
import { isoDate, parseIsoDate, type IsoDate } from "@/lib/time/pure";

export type ChangeRequestRow = {
  id: string;
  entryDate: IsoDate;
  taskId: string | null;
  taskTitle: string;
  person: string;
  minutes: number;
  note: string | null;
  reviewNote: string | null;
  billedAt: Date | null;
};

/**
 * M4.4 — approved out-of-scope entries of a project (RLS: the project's PM
 * and C-Level see them), optionally limited to a period.
 */
export async function listChangeRequests(user: CurrentUser, projectId: string, from?: IsoDate, to?: IsoDate): Promise<ChangeRequestRow[]> {
  const rows = await asUser(user, (tx) =>
    tx.timeEntry.findMany({
      where: {
        projectId,
        oosStatus: "approved",
        ...(from || to ? { entryDate: { ...(from ? { gte: parseIsoDate(from) } : {}), ...(to ? { lte: parseIsoDate(to) } : {}) } } : {}),
      },
      include: { task: { select: { title: true } }, user: { select: { fullName: true } } },
      orderBy: [{ task: { title: "asc" } }, { entryDate: "asc" }],
    }),
  );
  return rows.map((e) => ({
    id: e.id,
    entryDate: isoDate(e.entryDate),
    taskId: e.taskId,
    taskTitle: e.task?.title ?? "—",
    person: e.user.fullName,
    minutes: e.minutes,
    note: e.note,
    reviewNote: e.oosNote,
    billedAt: e.billedAt,
  }));
}
