import { addDays, addMonths, weekStart, type IsoDate } from "@/lib/time/pure";
import type { Direction, MetricDefinition, MetricFilters } from "@/lib/kpi/definition";

/**
 * KPI math (PRD Phase 2 "Skor dan grade"), shared by the engine, the
 * builder's preview / simulation and the snapshot job. Every metric becomes a
 * 0–100 score with the same rules.
 */

/** One row of a metric's source, already in the person's time zone. */
export type MetricRow = {
  userId: string;
  date: IsoDate;
  status?: string | null;
  typeKey?: string | null;
  tags?: string[];
  onTime?: boolean | null;
  projectKind?: "client" | "internal" | null;
  projectRole?: "pm" | "member" | null;
  value?: number | null;
  total?: number | null;
  /** Deliverable / shot a row belongs to, for averages per group. */
  group?: string | null;
};

export type Window = { start: IsoDate; end: IsoDate };

export function matches(row: MetricRow, f: MetricFilters | undefined): boolean {
  if (!f) return true;
  const tags = row.tags ?? [];
  if (f.types?.length && !f.types.includes(row.typeKey ?? "")) return false;
  if (f.tags?.length && !f.tags.some((t) => tags.includes(t))) return false;
  if (f.excludeTags?.length && f.excludeTags.some((t) => tags.includes(t))) return false;
  if (f.statuses?.length && !f.statuses.includes(row.status ?? "")) return false;
  if (f.onTime !== undefined && row.onTime !== f.onTime) return false;
  if (f.projectKinds?.length && !f.projectKinds.includes(row.projectKind ?? "internal")) return false;
  if (f.projectRole && row.projectRole !== f.projectRole) return false;
  return true;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);

/** Metric weeks (Monday starts) whose Monday falls in the window — at least one. */
export function weeksIn(w: Window): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = weekStart(w.start) < w.start ? addDays(weekStart(w.start), 7) : w.start; d <= w.end; d = addDays(d, 7)) out.push(weekStart(d));
  return out.length ? out : [weekStart(w.start)];
}

/**
 * The metric's actual value over the window, from its source rows. Counts and
 * sums are always a number (zero is a result); shares and averages are null
 * when there's nothing to divide by — "no data", left out of the score.
 * Composite metrics are combined by the engine.
 */
export function aggregate(def: MetricDefinition, rows: MetricRow[], w: Window, extraFilter?: MetricFilters): number | null {
  const base = rows.filter((r) => r.date >= w.start && r.date <= w.end && matches(r, def.filters) && matches(r, extraFilter));
  switch (def.aggregation) {
    case "count":
      return def.distinctWeeks ? new Set(base.map((r) => weekStart(r.date))).size : base.length;
    case "sum":
      return round1(sum(base.map((r) => r.value ?? 0)));
    case "percent": {
      if (def.weekly) {
        const weeks = new Map<IsoDate, MetricRow[]>();
        for (const r of base) weeks.set(weekStart(r.date), [...(weeks.get(weekStart(r.date)) ?? []), r]);
        const pcts = [...weeks.values()].map((ws) => (ws.filter((r) => matches(r, def.part)).length / ws.length) * 100);
        const a = avg(pcts);
        return a === null ? null : round1(a);
      }
      if (!base.length) return null;
      return round1((base.filter((r) => matches(r, def.part)).length / base.length) * 100);
    }
    case "ratio": {
      const total = sum(base.map((r) => r.total ?? 0));
      return total > 0 ? round1((sum(base.map((r) => r.value ?? 0)) / total) * 100) : null;
    }
    case "average": {
      if (def.per === "week") return round1(base.length / weeksIn(w).length);
      if (def.per === "group") {
        const groups = new Map<string, MetricRow[]>();
        for (const r of base) groups.set(r.group ?? "none", [...(groups.get(r.group ?? "none") ?? []), r]);
        const a = avg([...groups.values()].map((g) => (def.distinctWeeks ? new Set(g.map((r) => weekStart(r.date))).size : g.length)));
        return a === null ? null : round1(a);
      }
      const a = avg(base.filter((r) => r.value != null).map((r) => r.value!));
      return a === null ? null : round1(a);
    }
    case "rating": {
      const a = avg(base.filter((r) => r.value != null).map((r) => r.value!));
      return a === null ? null : round1((a / 5) * 100);
    }
    case "composite":
      return null;
  }
}

/**
 * Normalised score 0–100 (PRD table): higher → min(100, actual ÷ target);
 * lower → 100 at or under target, else target ÷ actual; recorded only → null.
 */
export function normalize(actual: number | null, target: number | null, direction: Direction): number | null {
  if (actual === null || target === null || direction === "record") return null;
  if (direction === "higher") {
    if (target <= 0) return 100;
    return round1(Math.max(0, Math.min(100, (actual / target) * 100)));
  }
  if (actual <= target) return 100;
  if (target <= 0) return 0;
  return round1(Math.max(0, Math.min(100, (target / actual) * 100)));
}

/** KPI score = Σ(weight × score) ÷ Σ weight over items that have a score. Null when none has. */
export function weightedScore(items: { score: number | null; weight: number; scored: boolean }[]): number | null {
  const counted = items.filter((i) => i.scored && i.score !== null && i.weight > 0);
  const w = sum(counted.map((i) => i.weight));
  return w > 0 ? round1(sum(counted.map((i) => i.weight * i.score!)) / w) : null;
}

export const GRADES = [
  { grade: "A", min: 84, label: "Excellent", action: "Keep going; bonus where possible" },
  { grade: "B", min: 67, label: "Good", action: "Light review" },
  { grade: "C", min: 50, label: "Fair", action: "Monitoring and a 1-on-1" },
  { grade: "D", min: 34, label: "Below expectations", action: "Scheduled coaching and an improvement plan" },
  { grade: "E", min: 0, label: "Poor", action: "Coaching or moving tasks" },
] as const;
export type Grade = (typeof GRADES)[number]["grade"];

export function gradeOf(score: number | null): (typeof GRADES)[number] | null {
  if (score === null) return null;
  return GRADES.find((g) => score >= g.min) ?? GRADES[GRADES.length - 1]!;
}

/** Aggregations whose targets are counts — pro-rated; shares stay as they are. */
export const isCountLike = (def: MetricDefinition) => def.aggregation === "count" || def.aggregation === "sum";

/**
 * Pro-rata (PRD): count targets shrink for part-time, new joiners and
 * probation — by contract hours (of a 40-hour week) and by the share of the
 * period they were employed. Percent targets don't change.
 */
export function proRataFactor(p: { weeklyHours: number | null; activeFrom: IsoDate | null }, w: Window): number {
  const hours = p.weeklyHours && p.weeklyHours > 0 ? Math.min(1, p.weeklyHours / 40) : 1;
  const days = (a: IsoDate, b: IsoDate) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
  const employed = p.activeFrom && p.activeFrom > w.start ? Math.max(0, days(p.activeFrom > w.end ? w.end : p.activeFrom, w.end)) / days(w.start, w.end) : 1;
  return Math.round(hours * employed * 1000) / 1000;
}

/** The 2-month calibration: a period starting within two months of `since` doesn't affect reward. */
export function inCalibration(since: IsoDate | null, periodStart: IsoDate): boolean {
  return Boolean(since && periodStart < addMonths(since.slice(0, 8) + "01", 2) && periodStart >= since.slice(0, 8) + "01");
}

/** First and last day of the month / half-year containing `d`. */
export function periodOf(kind: "monthly" | "semester", d: IsoDate): Window {
  const m = d.slice(0, 7) + "-01";
  if (kind === "monthly") return { start: m, end: addDays(addMonths(m, 1), -1) };
  const half = Number(d.slice(5, 7)) <= 6 ? `${d.slice(0, 4)}-01-01` : `${d.slice(0, 4)}-07-01`;
  return { start: half, end: addDays(addMonths(half, 6), -1) };
}

export type ItemResult = {
  metricKey: string;
  name: string;
  unit: string;
  direction: Direction;
  actual: number | null;
  target: number | null;
  score: number | null;
  weight: number;
  /** Counts toward this period's score (semester items show as progress in a month). */
  scored: boolean;
  manual: boolean;
};

/** Non-blocking warnings for a template (PRD "Peringatan"). */
export function templateWarnings(
  items: { name: string; weight: number; isRating: boolean; target: number | null; recordOnly: boolean; lastActual?: number | null; hasRecentData?: boolean }[],
): string[] {
  const out: string[] = [];
  const total = sum(items.filter((i) => !i.recordOnly).map((i) => i.weight));
  const rating = sum(items.filter((i) => i.isRating && !i.recordOnly).map((i) => i.weight));
  if (total > 0 && rating / total > 0.3) out.push(`Rating metrics weigh ${Math.round((rating / total) * 100)}% — keep them at 30% or less.`);
  for (const i of items) {
    if (i.hasRecentData === false) out.push(`${i.name} has had no data in the last 30 days.`);
    if (i.target !== null && i.lastActual != null && i.lastActual > 0 && (i.target > i.lastActual * 2 || i.target < i.lastActual / 2)) {
      out.push(`${i.name}: the target (${i.target}) is far from last month's actual (${i.lastActual}).`);
    }
  }
  return out;
}

/** Non-blocking warnings for a person's OKRs. */
export function okrWarnings(objectives: { title: string; keyResults: { title: string; kind: string; doneDefinition: string | null }[] }[]): string[] {
  const out: string[] = [];
  if (objectives.length > 5) out.push(`${objectives.length} objectives — aim for 5 or fewer.`);
  for (const o of objectives) {
    if (o.keyResults.length > 5) out.push(`“${o.title}” has ${o.keyResults.length} key results — aim for 5 or fewer.`);
    for (const k of o.keyResults) if (k.kind === "milestone" && !k.doneDefinition?.trim()) out.push(`Milestone “${k.title}” has no definition of done.`);
  }
  return out;
}

/** Key result progress 0–100: milestones done / not (or checklist share), the rest from start toward target. */
export function krProgress(kr: { kind: string; start: number | null; target: number | null; current: number | null; done: boolean; checklist?: { done: number; total: number } }): number | null {
  if (kr.kind === "milestone") {
    if (kr.done) return 100;
    if (kr.checklist && kr.checklist.total > 0) return Math.round((kr.checklist.done / kr.checklist.total) * 100);
    return 0;
  }
  if (kr.current === null || kr.target === null) return null;
  const start = kr.start ?? 0;
  if (kr.kind === "lower_better") {
    if (kr.current <= kr.target) return 100;
    if (start <= kr.target) return 0;
    return Math.round(Math.max(0, Math.min(100, ((start - kr.current) / (start - kr.target)) * 100)));
  }
  if (kr.target === start) return kr.current >= kr.target ? 100 : 0;
  return Math.round(Math.max(0, Math.min(100, ((kr.current - start) / (kr.target - start)) * 100)));
}
