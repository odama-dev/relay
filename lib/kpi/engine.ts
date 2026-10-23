import "server-only";
import type { Metric, Prisma, ScorePeriod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addMonths, isoDate, parseIsoDate, todayIn, type IsoDate } from "@/lib/time/pure";
import { metricDefinitionSchema, type Direction, type MetricDefinition } from "@/lib/kpi/definition";
import { aggregate, gradeOf, inCalibration, isCountLike, normalize, periodOf, proRataFactor, weightedScore, type ItemResult, type Window } from "@/lib/kpi/pure";
import { calendar, sourceRows } from "@/lib/kpi/sources";

/**
 * The KPI engine: which templates apply to a person, each item's actual from
 * its metric definition, and the period's score and grade. Pure math is in
 * lib/kpi/pure.ts; rows come from lib/kpi/sources.ts.
 */

type Db = Prisma.TransactionClient;
const db = prisma as unknown as Db;
const TZ = "Asia/Jakarta";

export const parseDefinition = (m: Pick<Metric, "definition">): MetricDefinition => metricDefinitionSchema.parse(m.definition);

type TemplateVersion = Prisma.KpiTemplateGetPayload<{ include: { items: { include: { metric: true } } } }>;

/** The version of a lineage in force on `day`: the latest activated one that started by then. */
async function versionAt(lineageId: string, day: IsoDate): Promise<TemplateVersion | null> {
  return db.kpiTemplate.findFirst({
    where: { lineageId, status: { in: ["active", "archived"] }, effectiveFrom: { lte: parseIsoDate(day) }, activatedAt: { not: null } },
    orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
    include: { items: { include: { metric: true }, orderBy: { position: "asc" } } },
  });
}

/**
 * A person's templates on `day` (PRD "Template dipasang ke role, override per
 * orang"): their own core templates replace the job role's; add-ons from both
 * apply. Returns the templates and the earliest assignment start (for
 * calibration).
 */
export async function templatesFor(userId: string, day: IsoDate) {
  const person = await db.profile.findUnique({ where: { id: userId }, select: { jobRoleId: true } });
  const at = parseIsoDate(day);
  const assignments = await db.kpiAssignment.findMany({
    where: {
      startsOn: { lte: at },
      OR: [{ endsOn: null }, { endsOn: { gte: at } }],
      AND: [{ OR: [{ userId }, ...(person?.jobRoleId ? [{ jobRoleId: person.jobRoleId }] : [])] }],
    },
  });
  const own = assignments.filter((a) => a.userId === userId);
  const role = assignments.filter((a) => a.jobRoleId);
  const core = own.some((a) => a.kind === "core") ? own.filter((a) => a.kind === "core") : role.filter((a) => a.kind === "core");
  const chosen = [...core, ...own.filter((a) => a.kind === "addon"), ...role.filter((a) => a.kind === "addon")];
  const lineages = [...new Set(chosen.map((a) => a.lineageId))];
  const versions = (await Promise.all(lineages.map((l) => versionAt(l, day)))).filter((v): v is TemplateVersion => v !== null);
  const since = chosen.map((a) => isoDate(a.startsOn)).sort()[0] ?? null;
  // A brand-new template (its first version) also calibrates.
  const firstVersions = await db.kpiTemplate.findMany({ where: { lineageId: { in: lineages }, version: 1 }, select: { effectiveFrom: true } });
  const newest = firstVersions.map((t) => (t.effectiveFrom ? isoDate(t.effectiveFrom) : null)).filter((d): d is IsoDate => d !== null).sort().at(-1) ?? null;
  return { templates: versions, assignedSince: since, templateSince: newest };
}

/** People who report to `userId`, all the way down (for team-scope metrics). */
async function teamOf(userId: string): Promise<string[]> {
  const out: string[] = [];
  let frontier = [userId];
  for (let depth = 0; depth < 12 && frontier.length; depth++) {
    const next = await db.profile.findMany({ where: { managerId: { in: frontier }, status: "active" }, select: { id: true } });
    frontier = next.map((p) => p.id).filter((id) => !out.includes(id));
    out.push(...frontier);
  }
  return out;
}

type Ctx = { cal: Awaited<ReturnType<typeof calendar>>; today: IsoDate; metrics: Map<string, Metric> };

async function context(): Promise<Ctx> {
  const [cal, metrics] = await Promise.all([calendar(db), db.metric.findMany()]);
  return { cal, today: todayIn(TZ), metrics: new Map(metrics.map((m) => [m.key, m])) };
}

/** A metric's actual for one person over a window (composites combine their parts). */
export async function metricActual(metric: Metric, userId: string, w: Window, ctx?: Ctx, tag?: string | null, depth = 0): Promise<number | null> {
  const c = ctx ?? (await context());
  const def = parseDefinition(metric);
  if (def.aggregation === "composite") {
    if (depth > 2) return null;
    const parts = await Promise.all(
      (def.components ?? []).map(async (comp) => {
        const m = c.metrics.get(comp.metricKey);
        if (!m) return null;
        const actual = await metricActual(m, userId, w, c, null, depth + 1);
        return { score: normalize(actual, comp.target, comp.direction), weight: comp.weight, scored: true };
      }),
    );
    return weightedScore(parts.filter((p): p is NonNullable<typeof p> => p !== null));
  }
  const users = def.scope === "team" ? await teamOf(userId) : [userId];
  const rows = await sourceRows(db, def.source, users, w, def, { metricId: metric.id, cal: c.cal, today: c.today });
  return aggregate(def, rows, w, tag ? { tags: [tag] } : undefined);
}

export type KpiComputation = {
  userId: string;
  periodKind: ScorePeriod;
  window: Window;
  items: (ItemResult & { templateName: string; kind: "core" | "addon"; targetPer: string; progressOf?: Window })[];
  score: number | null;
  grade: string | null;
  calibration: boolean;
  hasKpi: boolean;
};

/**
 * One person's KPI over a month or a half-year. In a month, semester items
 * show as progress toward their target and don't count in the score (PRD
 * "jumlah berperiode panjang tampil sebagai progres").
 */
export async function computeKpi(userId: string, periodKind: ScorePeriod, day: IsoDate, ctx?: Ctx): Promise<KpiComputation> {
  const c = ctx ?? (await context());
  const window = periodOf(periodKind, day);
  const { templates, assignedSince, templateSince } = await templatesFor(userId, window.start);
  const capacity = await db.personCapacity.findFirst({ where: { userId, effectiveFrom: { lte: parseIsoDate(window.end) } }, orderBy: { effectiveFrom: "desc" } });
  const firstCapacity = await db.personCapacity.findFirst({ where: { userId }, orderBy: { effectiveFrom: "asc" }, select: { effectiveFrom: true } });
  const factor = proRataFactor({ weeklyHours: capacity ? Number(capacity.weeklyHours) : null, activeFrom: firstCapacity ? isoDate(firstCapacity.effectiveFrom) : null }, window);

  const items: KpiComputation["items"] = [];
  for (const t of templates) {
    for (const it of t.items) {
      const def = parseDefinition(it.metric);
      const direction = it.metric.direction as Direction;
      const semesterItem = it.scorePeriod === "semester";
      const progressWindow = semesterItem && periodKind === "monthly" ? { start: periodOf("semester", day).start, end: window.end } : window;
      const actual = await metricActual(it.metric, userId, progressWindow, c, it.tag);
      const baseTarget = it.target == null ? null : Number(it.target);
      // Pro-rata only loosens count targets to reach; a cap (lower is better) stays.
      const target = baseTarget !== null && isCountLike(def) && direction === "higher" ? Math.round(baseTarget * factor * 10) / 10 : baseTarget;
      const scored = !it.recordOnly && direction !== "record" && !(semesterItem && periodKind === "monthly");
      items.push({
        metricKey: it.metric.key + (it.tag ? `:${it.tag}` : ""),
        name: it.metric.name + (it.tag ? ` (${it.tag.replace(/_/g, " ")})` : ""),
        unit: it.metric.unit,
        direction,
        actual,
        target,
        score: normalize(actual, target, direction),
        weight: Number(it.weight),
        scored,
        manual: it.metric.manual,
        templateName: t.name,
        kind: t.kind,
        targetPer: it.targetPer,
        ...(semesterItem && periodKind === "monthly" ? { progressOf: progressWindow } : {}),
      });
    }
  }
  const score = weightedScore(items);
  return {
    userId,
    periodKind,
    window,
    items,
    score,
    grade: gradeOf(score)?.grade ?? null,
    calibration: inCalibration(assignedSince, window.start) || inCalibration(templateSince, window.start),
    hasKpi: templates.length > 0,
  };
}

/** Writes the snapshot (kpi_results). Old results never change — a period is written once. */
export async function snapshotKpi(userId: string, periodKind: ScorePeriod, day: IsoDate, ctx?: Ctx): Promise<boolean> {
  const window = periodOf(periodKind, day);
  const exists = await db.kpiResult.findUnique({ where: { userId_periodKind_periodStart: { userId, periodKind, periodStart: parseIsoDate(window.start) } }, select: { id: true } });
  if (exists) return false;
  const r = await computeKpi(userId, periodKind, day, ctx);
  if (!r.hasKpi) return false;
  await db.kpiResult.create({
    data: {
      userId,
      periodKind,
      periodStart: parseIsoDate(window.start),
      periodEnd: parseIsoDate(window.end),
      items: r.items as unknown as Prisma.InputJsonValue,
      score: r.score,
      grade: r.grade,
      calibration: r.calibration,
    },
  });
  return true;
}

/** Last month's actual per active person — the builder's preview from real data. */
export async function previewMetric(metric: Metric, userIds: string[]): Promise<{ userId: string; actual: number | null }[]> {
  const c = await context();
  const lastMonth = periodOf("monthly", addMonths(c.today.slice(0, 8) + "01", -1));
  return Promise.all(userIds.map(async (userId) => ({ userId, actual: await metricActual(metric, userId, lastMonth, c) })));
}

/** "Simulasi": a template version scored for these people with last month's data, before it goes live. */
export async function simulateTemplate(templateId: string, userIds: string[]) {
  const c = await context();
  const t = await db.kpiTemplate.findUniqueOrThrow({ where: { id: templateId }, include: { items: { include: { metric: true }, orderBy: { position: "asc" } } } });
  const lastMonth = periodOf("monthly", addMonths(c.today.slice(0, 8) + "01", -1));
  return Promise.all(
    userIds.map(async (userId) => {
      const items = await Promise.all(
        t.items.map(async (it) => {
          const direction = it.metric.direction as Direction;
          const actual = await metricActual(it.metric, userId, lastMonth, c, it.tag);
          const target = it.target == null ? null : Number(it.target);
          return { name: it.metric.name, actual, target, score: normalize(actual, target, direction), weight: Number(it.weight), scored: !it.recordOnly && direction !== "record" && it.scorePeriod === "monthly" };
        }),
      );
      const score = weightedScore(items);
      return { userId, items, score, grade: gradeOf(score)?.grade ?? null };
    }),
  );
}

export { context as kpiContext };
