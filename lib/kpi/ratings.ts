import "server-only";
import type { RatingFrequency } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { hasModule } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { addDays, isoDate, monthStart, parseIsoDate, weekStart, type IsoDate } from "@/lib/time/pure";
import { templatesFor } from "@/lib/kpi/engine";

export const periodStartFor = (f: RatingFrequency, today: IsoDate) => (f === "weekly" ? weekStart(today) : monthStart(today));

export type RatingTask = {
  formId: string;
  formName: string;
  frequency: RatingFrequency;
  periodStart: IsoDate;
  subject: { id: string; name: string };
  criteria: { id: string; title: string; scale: string[] }[];
  response: { id: string; scores: Record<string, number>; comment: string | null; approved: boolean } | null;
};

/** Metric ids in each person's KPI today (definitions are open to everyone). */
async function metricsByPerson(ids: string[], today: IsoDate): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const id of ids) {
    const { templates } = await templatesFor(id, today);
    out.set(id, new Set(templates.flatMap((t) => t.items.map((i) => i.metricId))));
  }
  return out;
}

/**
 * The ratings the viewer owes this period (PRD "Form penilaian"): as
 * themselves, as a manager, as a job role, as a named rater, or as a peer on
 * a project they both worked on this week. The database re-checks the rater
 * on submit (rating_responses_guard).
 */
export async function loadRatingTasks(user: CurrentUser, today: IsoDate): Promise<RatingTask[]> {
  const forms = await asUser(user, (tx) =>
    tx.ratingForm.findMany({ where: { status: "active" }, include: { criteria: { orderBy: { position: "asc" } } }, orderBy: { name: "asc" } }),
  );
  if (!forms.length) return [];
  // People and their KPIs are read on the system connection: who is rated is
  // the definitions' business, the answers stay under RLS.
  const people = await prisma.profile.findMany({ where: { status: "active" }, select: { id: true, fullName: true, managerId: true, jobRoleId: true } });
  const me = people.find((p) => p.id === user.id);
  const kpis = await metricsByPerson(people.map((p) => p.id), today);
  const tasks: RatingTask[] = [];
  for (const f of forms) {
    const period = periodStartFor(f.frequency, today);
    const end = f.frequency === "weekly" ? addDays(period, 6) : addDays(isoDate(new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 1))), -1);
    const rated = people.filter((p) => kpis.get(p.id)?.has(f.metricId));
    let subjects: typeof people = [];
    if (f.raterKind === "self") subjects = rated.filter((p) => p.id === user.id);
    else if (f.raterKind === "manager") subjects = rated.filter((p) => p.managerId === user.id);
    else if (f.raterKind === "job_role") subjects = me?.jobRoleId && me.jobRoleId === f.raterJobRoleId ? rated.filter((p) => p.id !== user.id) : [];
    else if (f.raterKind === "assigned") {
      const assigned = await asUser(user, (tx) => tx.ratingFormRater.findMany({ where: { formId: f.id, raterId: user.id }, select: { subjectId: true } }));
      subjects = rated.filter((p) => assigned.some((a) => a.subjectId === p.id));
    } else if (f.raterKind === "project_peer") {
      const window = { gte: parseIsoDate(period), lte: parseIsoDate(end) };
      const [entries, tasksTouched] = await Promise.all([
        prisma.timeEntry.findMany({ where: { entryDate: window, projectId: { not: null } }, select: { userId: true, projectId: true } }),
        prisma.task.findMany({ where: { updatedAt: { gte: parseIsoDate(period), lte: parseIsoDate(addDays(end, 1)) }, ownerId: { not: null } }, select: { ownerId: true, projectId: true } }),
      ]);
      const projectsOf = (id: string) => new Set([...entries.filter((e) => e.userId === id).map((e) => e.projectId!), ...tasksTouched.filter((t) => t.ownerId === id).map((t) => t.projectId)]);
      const mine = projectsOf(user.id);
      subjects = rated.filter((p) => p.id !== user.id && [...projectsOf(p.id)].some((x) => mine.has(x)));
    }
    if (!subjects.length) continue;
    const responses = await asUser(user, (tx) =>
      tx.ratingResponse.findMany({ where: { formId: f.id, raterId: user.id, periodStart: parseIsoDate(period), subjectId: { in: subjects.map((s) => s.id) } } }),
    );
    for (const s of subjects) {
      const r = responses.find((x) => x.subjectId === s.id);
      tasks.push({
        formId: f.id,
        formName: f.name,
        frequency: f.frequency,
        periodStart: period,
        subject: { id: s.id, name: s.fullName },
        criteria: f.criteria.map((c) => ({ id: c.id, title: c.title, scale: c.scale })),
        response: r ? { id: r.id, scores: r.scores as Record<string, number>, comment: r.comment, approved: Boolean(r.approvedAt) } : null,
      });
    }
  }
  return tasks;
}

/** Self-assessments waiting for the People module's approval. */
export async function loadRatingApprovals(user: CurrentUser) {
  if (!hasModule(user, "people")) return [];
  const rows = await asUser(user, (tx) =>
    tx.ratingResponse.findMany({
      where: { approvedAt: null, form: { needsApproval: true }, subjectId: { not: user.id } },
      include: { form: { select: { name: true, criteria: { orderBy: { position: "asc" }, select: { id: true, title: true } } } }, subject: { select: { fullName: true } } },
      orderBy: { createdAt: "asc" },
    }),
  );
  return rows.map((r) => ({
    id: r.id,
    formName: r.form.name,
    subject: r.subject.fullName,
    periodStart: isoDate(r.periodStart),
    average: Number(r.average),
    comment: r.comment,
    scores: r.form.criteria.map((c) => ({ title: c.title, score: (r.scores as Record<string, number>)[c.id] ?? null })),
  }));
}
