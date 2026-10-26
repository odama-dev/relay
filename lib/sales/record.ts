import "server-only";
import { asUser, type CurrentUser } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { numOr0 } from "@/lib/money";
import { isoDate } from "@/lib/time/pure";
import { loadNotes, type NoteView } from "@/lib/crm/queries";
import { crmMail, type MailView } from "@/lib/mail/queries";

export type DealRecord = {
  id: string;
  notes: NoteView[];
  mail: MailView[];
  /** The deal's person first, then the rest of its company. */
  people: { id: string; name: string; email: string | null; jobTitle: string | null }[];
  history: { id: string; at: string; from: string | null; to: string; by: string | null; value: number; currency: string }[];
  stages: { name: string; category: string; color: string | null }[];
  nextTask: { id: string; title: string; dueDate: string; projectId: string; projectCode: string } | null;
  /** The company's client, when the company is one — opens the client panel. */
  companyClientId: string | null;
  viewer: { canWriteNotes: boolean; timeZone: string };
};

/** What the deal side panel adds to the pipeline row, read under RLS. */
export async function getDealRecord(user: CurrentUser, id: string): Promise<DealRecord | null> {
  const deal = await asUser(user, (tx) =>
    tx.deal.findUnique({ where: { id }, select: { id: true, personId: true, companyId: true, projectId: true, company: { select: { clientId: true } } } }),
  );
  if (!deal) return null;
  const [notes, mail, rows] = await Promise.all([
    loadNotes(user, { dealId: deal.id }),
    crmMail(user, { companyId: deal.companyId, personIds: deal.personId ? [deal.personId] : [] }),
    asUser(user, async (tx) => {
      const people = await tx.crmPerson.findMany({
        where: { archivedAt: null, OR: [...(deal.personId ? [{ id: deal.personId }] : []), ...(deal.companyId ? [{ companyId: deal.companyId }] : [])] },
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true, jobTitle: true },
      });
      const history = await tx.dealStageHistory.findMany({ where: { dealId: deal.id }, orderBy: { changedAt: "desc" }, take: 50 });
      const stages = await tx.pipelineStage.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true, category: true, color: true, isHidden: true } });
      const byIds = [...new Set(history.flatMap((h) => (h.changedBy ? [h.changedBy] : [])))];
      const profiles = byIds.length ? await tx.profile.findMany({ where: { id: { in: byIds } }, select: { id: true, fullName: true } }) : [];
      const task = deal.projectId
        ? await tx.task.findFirst({
            where: { projectId: deal.projectId, status: { not: "done" }, dueDate: { not: null } },
            orderBy: { dueDate: "asc" },
            select: { id: true, title: true, dueDate: true, project: { select: { id: true, code: true } } },
          })
        : null;
      return { people, history, stages, profiles, task };
    }),
  ]);
  const stageName = new Map(rows.stages.map((s) => [s.id, s.name]));
  const who = new Map(rows.profiles.map((p) => [p.id, p.fullName]));
  return {
    id: deal.id,
    notes,
    mail,
    people: [...rows.people].sort((a, b) => Number(b.id === deal.personId) - Number(a.id === deal.personId)),
    history: rows.history.map((h) => ({
      id: h.id,
      at: h.changedAt.toISOString(),
      from: h.fromStageId ? (stageName.get(h.fromStageId) ?? null) : null,
      to: stageName.get(h.toStageId) ?? "—",
      by: h.changedBy ? (who.get(h.changedBy) ?? null) : null,
      value: numOr0(h.value),
      currency: h.currency,
    })),
    stages: rows.stages.filter((s) => !s.isHidden).map((s) => ({ name: s.name, category: s.category, color: s.color })),
    nextTask: rows.task?.dueDate
      ? { id: rows.task.id, title: rows.task.title, dueDate: isoDate(rows.task.dueDate), projectId: rows.task.project.id, projectCode: rows.task.project.code }
      : null,
    companyClientId: deal.company?.clientId ?? null,
    viewer: { canWriteNotes: perms.manageDeals(user), timeZone: user.timezone },
  };
}
