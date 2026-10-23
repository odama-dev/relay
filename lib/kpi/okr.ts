import "server-only";
import type { KeyResultKind, KeyResultSource, ObjectiveStatus, OkrCycleStatus } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { isoDate, monthStart, type IsoDate } from "@/lib/time/pure";
import { kpiContext, metricActual } from "@/lib/kpi/engine";
import { krProgress, okrWarnings } from "@/lib/kpi/pure";

export type KeyResultView = {
  id: string;
  title: string;
  kind: KeyResultKind;
  source: KeyResultSource;
  metric: { id: string; name: string } | null;
  start: number | null;
  target: number | null;
  unit: string;
  current: number | null;
  progress: number | null;
  doneDefinition: string | null;
  approver: { id: string; name: string } | null;
  doneAt: Date | null;
  doneApproved: boolean;
  tasks: { id: string; title: string; done: boolean; projectId: string }[];
  checkins: { month: IsoDate; value: number | null; note: string | null; evidenceUrl: string | null }[];
  checkedInThisMonth: boolean;
};

export type ObjectiveView = {
  id: string;
  title: string;
  description: string | null;
  isStudio: boolean;
  parent: { id: string; title: string } | null;
  status: ObjectiveStatus;
  owners: { id: string; name: string; avatarUrl: string | null }[];
  proposedBy: string | null;
  progress: number | null;
  keyResults: KeyResultView[];
  canEdit: boolean;
  isOwner: boolean;
};

export type CycleView = { id: string; name: string; startDate: IsoDate; endDate: IsoDate; status: OkrCycleStatus };

/** A cycle's objectives with key result progress (metric, linked tasks or the latest check-in). */
export async function loadOkr(user: CurrentUser, cycleId: string | undefined, today: IsoDate) {
  const { cycles, cycle, objectives, editable } = await asUser(user, async (tx) => {
    const cycles = await tx.okrCycle.findMany({ orderBy: { startDate: "desc" } });
    const cycle = cycles.find((c) => c.id === cycleId) ?? cycles.find((c) => c.status === "active") ?? cycles[0] ?? null;
    if (!cycle) return { cycles, cycle, objectives: [], editable: new Set<string>() };
    const objectives = await tx.objective.findMany({
      where: { cycleId: cycle.id, status: { not: "archived" } },
      orderBy: [{ isStudio: "desc" }, { createdAt: "asc" }],
      include: {
        parent: { select: { id: true, title: true } },
        owners: { include: { user: { select: { id: true, fullName: true, avatarUrl: true } } } },
        keyResults: {
          orderBy: { position: "asc" },
          include: {
            metric: true,
            approver: { select: { id: true, fullName: true } },
            links: { include: { task: { select: { id: true, title: true, status: true, projectId: true } } } },
            checkins: { orderBy: { month: "desc" } },
          },
        },
      },
    });
    const can = objectives.length
      ? await tx.$queryRaw<{ id: string }[]>`SELECT o.id::text FROM public.objectives o WHERE o.cycle_id = ${cycle.id}::uuid AND app.can_edit_objective(o.id)`
      : [];
    return { cycles, cycle, objectives, editable: new Set(can.map((c) => c.id)) };
  });
  if (!cycle) return { cycles: [], cycle: null, objectives: [] as ObjectiveView[], warnings: [] as string[] };

  const ctx = await kpiContext();
  const window = { start: isoDate(cycle.startDate), end: isoDate(cycle.endDate) < today ? isoDate(cycle.endDate) : today };
  const thisMonth = monthStart(today);
  const views: ObjectiveView[] = [];
  for (const o of objectives) {
    const krs: KeyResultView[] = [];
    for (const k of o.keyResults) {
      const latest = k.checkins[0];
      let current: number | null = latest?.value == null ? null : Number(latest.value);
      // A metric-backed KR reads the metric for the objective's first owner over the cycle so far.
      if ((k.source === "metric" || k.kind === "kpi_linked") && k.metric && o.owners[0]) current = await metricActual(k.metric, o.owners[0].userId, window, ctx);
      const tasks = k.links.map((l) => ({ id: l.task.id, title: l.task.title, done: l.task.status === "done", projectId: l.task.projectId }));
      const checklist = k.source === "tasks" ? { done: tasks.filter((t) => t.done).length, total: tasks.length } : undefined;
      const done = k.kind === "milestone" ? Boolean(k.doneAt && k.doneApprovedBy) : false;
      krs.push({
        id: k.id,
        title: k.title,
        kind: k.kind,
        source: k.source,
        metric: k.metric ? { id: k.metric.id, name: k.metric.name } : null,
        start: k.startValue == null ? null : Number(k.startValue),
        target: k.targetValue == null ? null : Number(k.targetValue),
        unit: k.unit,
        current: k.source === "tasks" && checklist ? checklist.done : current,
        progress: krProgress({
          kind: k.kind === "kpi_linked" ? "count" : k.kind,
          start: k.startValue == null ? null : Number(k.startValue),
          target: k.targetValue == null ? null : Number(k.targetValue),
          current: k.source === "tasks" && checklist && k.kind !== "milestone" ? checklist.done : current,
          done,
          checklist,
        }),
        doneDefinition: k.doneDefinition,
        approver: k.approver ? { id: k.approver.id, name: k.approver.fullName } : null,
        doneAt: k.doneAt,
        doneApproved: Boolean(k.doneApprovedBy),
        tasks,
        checkins: k.checkins.map((c) => ({ month: isoDate(c.month), value: c.value == null ? null : Number(c.value), note: c.note, evidenceUrl: c.evidenceUrl })),
        checkedInThisMonth: k.checkins.some((c) => isoDate(c.month) === thisMonth),
      });
    }
    const scored = krs.filter((k) => k.progress !== null);
    views.push({
      id: o.id,
      title: o.title,
      description: o.description,
      isStudio: o.isStudio,
      parent: o.parent,
      status: o.status,
      owners: o.owners.map((w) => ({ id: w.user.id, name: w.user.fullName, avatarUrl: w.user.avatarUrl })),
      proposedBy: o.proposedBy,
      progress: scored.length ? Math.round(scored.reduce((s, k) => s + k.progress!, 0) / scored.length) : null,
      keyResults: krs,
      canEdit: editable.has(o.id),
      isOwner: o.owners.some((w) => w.userId === user.id),
    });
  }
  const mine = views.filter((v) => v.isOwner && !v.isStudio);
  return {
    cycles: cycles.map((c): CycleView => ({ id: c.id, name: c.name, startDate: isoDate(c.startDate), endDate: isoDate(c.endDate), status: c.status })),
    cycle: { id: cycle.id, name: cycle.name, startDate: isoDate(cycle.startDate), endDate: isoDate(cycle.endDate), status: cycle.status } as CycleView,
    objectives: views,
    warnings: okrWarnings(mine.map((o) => ({ title: o.title, keyResults: o.keyResults.map((k) => ({ title: k.title, kind: k.kind, doneDefinition: k.doneDefinition })) }))),
  };
}
