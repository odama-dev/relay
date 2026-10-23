/**
 * Metric Dictionary (PRD Phase 2): the words behind every dashboard number.
 * The math lives in ./pure.ts; this is what /metrics and the ⓘ hints show.
 */
export type MetricDefinition = {
  key: string;
  term: string;
  definition: string;
  /** Where the number is shown. */
  usedOn: string[];
};

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    key: "week",
    term: "Week",
    definition: "Monday to Friday. A task due on Saturday or Sunday belongs to the same week.",
    usedOn: ["Designer & Developer", "PM", "HR", "KPI"],
  },
  {
    key: "logged_hours",
    term: "Logged hours",
    definition: "Hours in the timesheet dated in the period, non-billable included.",
    usedOn: ["Designer & Developer", "PM", "HR", "C-Level"],
  },
  {
    key: "billable",
    term: "Billable",
    definition: "Hours logged on a client project's task. Out-of-scope hours still waiting for the PM don't count until approved.",
    usedOn: ["Designer & Developer", "PM", "C-Level"],
  },
  {
    key: "capacity",
    term: "Capacity",
    definition: "Contract hours per week, less approved leave and public holidays.",
    usedOn: ["PM", "HR", "C-Level"],
  },
  {
    key: "utilization",
    term: "Utilization",
    definition: "Billable hours ÷ capacity — only for billable divisions (Design, Development, Project). Other divisions are shown separately.",
    usedOn: ["PM", "C-Level"],
  },
  {
    key: "workload",
    term: "Workload",
    definition: "Estimated hours of open tasks due in the period (overdue included) ÷ capacity. Not utilization: it has its own label and colour, and is marked when overdue work fills most of it.",
    usedOn: ["HR", "PM"],
  },
  {
    key: "on_time",
    term: "On time",
    definition: "A task approved on or before its effective due date (the due date plus any time the reviewer took beyond the one-working-day SLA). Tasks without a due date aren't counted.",
    usedOn: ["Designer & Developer", "PM", "C-Level", "KPI"],
  },
  {
    key: "overdue",
    term: "Overdue",
    definition: "Not yet approved, and the effective due date has passed.",
    usedOn: ["Designer & Developer", "PM", "HR", "C-Level"],
  },
  {
    key: "delayed",
    term: "Delayed (project)",
    definition: "Past its end date, or has overdue tasks.",
    usedOn: ["PM", "C-Level"],
  },
  {
    key: "at_risk",
    term: "At risk (project)",
    definition: "A budget warning, a blocked task, on hold, or ending within 7 days with open tasks.",
    usedOn: ["PM", "C-Level"],
  },
  {
    key: "margin",
    term: "Margin (C-Level)",
    definition: "Revenue − (people cost + operating cost), on a cash basis: revenue is payments received. A running fixed-price project shows budget burn vs progress instead.",
    usedOn: ["C-Level"],
  },
  {
    key: "working_today",
    term: "Working today",
    definition: "Checked in as in office or remote today — not the same as having logged hours.",
    usedOn: ["HR"],
  },
];

export const metricDefinition = (key: string) => METRIC_DEFINITIONS.find((m) => m.key === key);
