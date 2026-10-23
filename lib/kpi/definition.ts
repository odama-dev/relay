import { z } from "zod";

/**
 * A metric is stored as a definition, never as code (PRD Phase 2 "Metrik
 * disimpan sebagai definisi"): which data, which rows, how to count, which
 * way is better. The engine (lib/kpi/engine.ts) reads it, so a new metric
 * needs no deploy.
 */

/** "Mau menghitung apa?" — the OS data a metric can read. */
export const METRIC_SOURCES = [
  "task",
  "shot",
  "content",
  "idea",
  "support_request",
  "qc_record",
  "error",
  "release",
  "testimony",
  "challenge",
  "project",
  "attendance",
  "timesheet",
  "review",
  "rating",
  "manual",
] as const;
export type MetricSource = (typeof METRIC_SOURCES)[number];

export const SOURCE_LABELS: Record<MetricSource, string> = {
  task: "Tasks",
  shot: "Output — shots",
  content: "Output — content",
  idea: "Ideas",
  support_request: "Support requests",
  qc_record: "QC records",
  error: "Errors",
  release: "Releases",
  testimony: "Testimonies",
  challenge: "Challenges",
  project: "Projects",
  attendance: "Attendance",
  timesheet: "Timesheet",
  review: "Reviews (as reviewer)",
  rating: "Rating form",
  manual: "Manual entry + evidence",
};

/** Sources read from work_logs, by kind. */
export const LOG_SOURCES = ["shot", "content", "idea", "support_request", "qc_record", "error", "release", "testimony", "challenge"] as const;
export type LogSource = (typeof LOG_SOURCES)[number];
export const isLogSource = (s: MetricSource): s is LogSource => (LOG_SOURCES as readonly string[]).includes(s);

/** "Yang mana saja?" */
export const filtersSchema = z
  .object({
    /** Task type keys (`content`, `bug`, `revision`…). */
    types: z.array(z.string().max(40)).max(20).optional(),
    /** Rows carrying any of these tags. */
    tags: z.array(z.string().max(40)).max(20).optional(),
    /** Rows carrying none of these tags. */
    excludeTags: z.array(z.string().max(40)).max(20).optional(),
    /** Row status (`approved`, `present`…). */
    statuses: z.array(z.string().max(40)).max(10).optional(),
    /** Only on-time (true) or late (false) rows. */
    onTime: z.boolean().optional(),
    projectKinds: z.array(z.enum(["client", "internal"])).max(2).optional(),
    /** Project source: projects the person runs (pm) or is on (member). */
    projectRole: z.enum(["pm", "member"]).optional(),
  })
  .strict();
export type MetricFilters = z.infer<typeof filtersSchema>;

/** "Dengan cara apa?" */
export const AGGREGATIONS = ["count", "sum", "percent", "ratio", "average", "rating", "composite"] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

export const AGGREGATION_LABELS: Record<Aggregation, string> = {
  count: "Count",
  sum: "Sum of values",
  percent: "Percentage (part ÷ total)",
  ratio: "Ratio of values (Σ value ÷ Σ total)",
  average: "Average",
  rating: "Rating (1–5)",
  composite: "Combination of metrics",
};

/** "Mana yang lebih baik?" */
export const DIRECTIONS = ["higher", "lower", "record"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const DIRECTION_LABELS: Record<Direction, string> = { higher: "Higher is better", lower: "Lower is better", record: "Recorded only" };

export const metricDefinitionSchema = z
  .object({
    source: z.enum(METRIC_SOURCES),
    /** The person's own rows, or their team's (everyone reporting to them). */
    scope: z.enum(["self", "team"]).default("self"),
    /** Tasks: count them on their (effective) due day or on the day they were approved. */
    dateBy: z.enum(["due", "approved"]).optional(),
    filters: filtersSchema.default({}),
    aggregation: z.enum(AGGREGATIONS),
    /** Percent: the share of the filtered rows that also match these. */
    part: filtersSchema.optional(),
    /** Average: of row values, of counts per week, or of counts per group (deliverable). */
    per: z.enum(["value", "week", "group"]).optional(),
    /** Count distinct weeks instead of rows (revision rounds). */
    distinctWeeks: z.boolean().optional(),
    /** Percent: score each week, then average the weeks (Task on Time). */
    weekly: z.boolean().optional(),
    /** Composite: weighted metrics (by key), each scored against its own target. */
    components: z
      .array(z.object({ metricKey: z.string(), weight: z.number().min(0).max(100), target: z.number().nullable(), direction: z.enum(DIRECTIONS) }))
      .max(10)
      .optional(),
  })
  .superRefine((d, ctx) => {
    if (d.aggregation === "percent" && !d.part) ctx.addIssue({ code: "custom", message: "A percentage needs the part to count", path: ["part"] });
    if (d.aggregation === "composite" && !d.components?.length) ctx.addIssue({ code: "custom", message: "Add the metrics to combine", path: ["components"] });
    if (d.aggregation === "rating" && d.source !== "rating") ctx.addIssue({ code: "custom", message: "Ratings come from a rating form", path: ["aggregation"] });
  });
export type MetricDefinition = z.infer<typeof metricDefinitionSchema>;

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`);
const nice = (s: string) => s.replace(/_/g, " ");

function describeFilters(f: MetricFilters | undefined): string {
  if (!f) return "";
  const parts: string[] = [];
  if (f.types?.length) parts.push(`of type ${list(f.types.map((t) => nice(t)))}`);
  if (f.tags?.length) parts.push(`tagged ${list(f.tags.map(nice))}`);
  if (f.excludeTags?.length) parts.push(`not tagged ${list(f.excludeTags.map(nice))}`);
  if (f.statuses?.length) parts.push(`that are ${list(f.statuses.map(nice))}`);
  if (f.onTime === true) parts.push("on time");
  if (f.onTime === false) parts.push("late");
  if (f.projectKinds?.length === 1) parts.push(`on ${f.projectKinds[0]} projects`);
  if (f.projectRole === "pm") parts.push("they run");
  return parts.join(" ");
}

const NOUN: Record<MetricSource, string> = {
  task: "tasks",
  shot: "shots",
  content: "content pieces",
  idea: "ideas",
  support_request: "support requests",
  qc_record: "QC records",
  error: "errors",
  release: "releases",
  testimony: "testimonies",
  challenge: "challenges",
  project: "projects",
  attendance: "workdays",
  timesheet: "hours logged",
  review: "reviews",
  rating: "ratings",
  manual: "manual entries",
};

/**
 * The plain sentence shown with every metric ("Number of tasks of type
 * content that are approved, per week, on average").
 */
export function explainMetric(d: MetricDefinition): string {
  const noun = NOUN[d.source];
  const f = describeFilters(d.filters);
  const what = [noun, f].filter(Boolean).join(" ");
  const team = d.scope === "team" ? " across their team" : "";
  switch (d.aggregation) {
    case "count":
      return d.distinctWeeks ? `Number of weeks with ${what}${team}.` : `Number of ${what}${team}.`;
    case "sum":
      return `Total value of ${what}${team}.`;
    case "percent": {
      const part = describeFilters(d.part) || "matching";
      return `Share of ${what} that are ${part}${team}${d.weekly ? ", scored per week and averaged" : ""}.`;
    }
    case "ratio":
      return `Sum of values ÷ sum of totals over ${what}${team}, as a percentage.`;
    case "average":
      return d.per === "week"
        ? `Number of ${what}${team} per week, on average.`
        : d.per === "group"
          ? `${d.distinctWeeks ? "Weeks" : "Number"} of ${what} per deliverable, on average${team}.`
          : `Average value of ${what}${team}.`;
    case "rating":
      return `Average rating (1–5) on the form, as a percentage of 5.`;
    case "composite":
      return `A weighted combination of ${d.components?.map((c) => nice(c.metricKey)).join(", ")}.`;
  }
}
