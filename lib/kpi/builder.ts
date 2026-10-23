import "server-only";
import { asUser, type CurrentUser } from "@/lib/auth";
import { isoDate, todayIn } from "@/lib/time/pure";
import { explainMetric, metricDefinitionSchema, type MetricDefinition } from "@/lib/kpi/definition";
import { templateWarnings } from "@/lib/kpi/pure";

/** Everything the KPI & OKR builder shows (People module; read under RLS). */
export async function loadBuilder(user: CurrentUser) {
  const today = todayIn(user.timezone);
  const d = await asUser(user, async (tx) => ({
    metrics: await tx.metric.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], include: { _count: { select: { items: true } } } }),
    templates: await tx.kpiTemplate.findMany({ orderBy: [{ name: "asc" }, { version: "desc" }], include: { items: { orderBy: { position: "asc" }, include: { metric: { select: { id: true, name: true, key: true, unit: true, definition: true } } } } } }),
    jobRoles: await tx.jobRole.findMany({ where: { archivedAt: null }, orderBy: [{ division: "asc" }, { level: "asc" }, { name: "asc" }], include: { kpiAssignments: true, _count: { select: { people: true } } } }),
    personAssignments: await tx.kpiAssignment.findMany({ where: { userId: { not: null } }, include: { user: { select: { fullName: true } } }, orderBy: { startsOn: "desc" } }),
    forms: await tx.ratingForm.findMany({ orderBy: { name: "asc" }, include: { criteria: { orderBy: { position: "asc" } }, raters: true, metric: { select: { name: true } } } }),
    cycles: await tx.okrCycle.findMany({ orderBy: { startDate: "desc" }, include: { _count: { select: { objectives: true } } } }),
    objections: await tx.kpiObjection.findMany({ where: { status: "open" }, include: { result: { select: { periodStart: true, periodKind: true, user: { select: { id: true, fullName: true } } } }, creator: { select: { fullName: true } } }, orderBy: { createdAt: "asc" } }),
    people: await tx.profile.findMany({ where: { status: "active" }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, avatarUrl: true } }),
    taskTypes: await tx.taskType.findMany({ where: { archivedAt: null }, orderBy: { position: "asc" }, select: { key: true, name: true } }),
  }));

  const def = (raw: unknown): MetricDefinition | null => {
    const p = metricDefinitionSchema.safeParse(raw);
    return p.success ? p.data : null;
  };

  // One row per template lineage: its versions, newest first.
  const lineages = new Map<string, typeof d.templates>();
  for (const t of d.templates) lineages.set(t.lineageId, [...(lineages.get(t.lineageId) ?? []), t]);
  const isActiveAssignment = (a: { endsOn: Date | null }) => !a.endsOn || isoDate(a.endsOn) >= today;

  return {
    metrics: d.metrics.map((m) => {
      const parsed = def(m.definition);
      return {
        id: m.id,
        key: m.key,
        name: m.name,
        description: m.description,
        unit: m.unit,
        direction: m.direction as "higher" | "lower" | "record",
        manual: m.manual,
        status: m.status,
        definition: parsed,
        sentence: parsed ? explainMetric(parsed) : "Invalid definition",
        usedIn: m._count.items,
      };
    }),
    templates: [...lineages.entries()].map(([lineageId, versions]) => {
      const live = versions.find((v) => v.status === "active") ?? null;
      const draft = versions.find((v) => v.status === "draft") ?? null;
      const shown = draft ?? live ?? versions[0]!;
      return {
        lineageId,
        name: shown.name,
        kind: shown.kind,
        live: live ? { id: live.id, version: live.version, effectiveFrom: live.effectiveFrom ? isoDate(live.effectiveFrom) : null } : null,
        draft: draft ? { id: draft.id, version: draft.version } : null,
        versions: versions.map((v) => ({ id: v.id, version: v.version, status: v.status, effectiveFrom: v.effectiveFrom ? isoDate(v.effectiveFrom) : null })),
        current: {
          id: shown.id,
          status: shown.status,
          name: shown.name,
          kind: shown.kind,
          description: shown.description,
          items: shown.items.map((i) => ({
            metricId: i.metricId,
            metricName: i.metric.name,
            unit: i.metric.unit,
            target: i.target == null ? null : Number(i.target),
            targetPer: i.targetPer as "week" | "month" | "semester",
            scorePeriod: i.scorePeriod,
            weight: Number(i.weight),
            recordOnly: i.recordOnly,
            tag: i.tag,
          })),
          warnings: templateWarnings(
            shown.items.map((i) => ({ name: i.metric.name, weight: Number(i.weight), isRating: def(i.metric.definition)?.aggregation === "rating", target: i.target == null ? null : Number(i.target), recordOnly: i.recordOnly })),
          ),
        },
      };
    }),
    jobRoles: d.jobRoles.map((r) => ({
      id: r.id,
      name: r.name,
      division: r.division,
      level: r.level,
      people: r._count.people,
      core: r.kpiAssignments.filter((a) => a.kind === "core" && isActiveAssignment(a)).map((a) => a.lineageId),
      addons: r.kpiAssignments.filter((a) => a.kind === "addon" && isActiveAssignment(a)).map((a) => a.lineageId),
    })),
    personAssignments: d.personAssignments
      .filter(isActiveAssignment)
      .map((a) => ({ id: a.id, person: a.user!.fullName, lineageId: a.lineageId, kind: a.kind, startsOn: isoDate(a.startsOn), endsOn: a.endsOn ? isoDate(a.endsOn) : null })),
    forms: d.forms.map((f) => ({
      id: f.id,
      metricId: f.metricId,
      metricName: f.metric.name,
      name: f.name,
      frequency: f.frequency,
      raterKind: f.raterKind,
      raterJobRoleId: f.raterJobRoleId,
      needsApproval: f.needsApproval,
      status: f.status,
      criteria: f.criteria.map((c) => ({ title: c.title, scale: c.scale })),
      raters: f.raters.map((r) => ({ subjectId: r.subjectId, raterId: r.raterId })),
    })),
    cycles: d.cycles.map((c) => ({ id: c.id, name: c.name, startDate: isoDate(c.startDate), endDate: isoDate(c.endDate), status: c.status, objectives: c._count.objectives })),
    objections: d.objections.map((o) => ({
      id: o.id,
      person: o.result.user.fullName,
      personId: o.result.user.id,
      period: isoDate(o.result.periodStart),
      periodKind: o.result.periodKind,
      metricKey: o.metricKey,
      reason: o.reason,
      createdAt: o.createdAt,
    })),
    people: d.people.map((p) => ({ id: p.id, name: p.fullName, avatarUrl: p.avatarUrl })),
    taskTypes: d.taskTypes,
  };
}

export type Builder = Awaited<ReturnType<typeof loadBuilder>>;
