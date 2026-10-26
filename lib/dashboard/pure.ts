import { fromMinor, toMinor } from "@/lib/invoices/pure";
import { utilizationPct as metricUtilization } from "@/lib/metrics/pure";
import { addDays, addMonths, monthStart, parseIsoDate, weekStart, type IsoDate } from "@/lib/time/pure";

/**
 * Dashboard rules (PRD/OVERVIEW-SPEC.md §1.3) — pure, so every card reads the
 * same definitions and the tests pin them down.
 */

export type Money = { currency: string; amount: number };

/** Amounts grouped per original currency (never converted, §1.4), summed in minor units. */
export function sumByCurrency(items: Money[]): Money[] {
  const minor = new Map<string, number>();
  for (const i of items) minor.set(i.currency, (minor.get(i.currency) ?? 0) + toMinor(i.amount, i.currency));
  return [...minor]
    .map(([currency, m]) => ({ currency, amount: fromMinor(m, currency) }))
    .sort((a, b) => (a.currency === "IDR" ? -1 : b.currency === "IDR" ? 1 : a.currency.localeCompare(b.currency)));
}

export type DueState = "late" | "due_soon";

/**
 * A pending payment request is late once its due date has passed, and due
 * soon from today up to `horizon` days ahead (§1.3). Null otherwise.
 */
export function requestDueState(due: IsoDate, today: IsoDate, horizon = 7): DueState | null {
  if (due < today) return "late";
  if (due <= addDays(today, horizon)) return "due_soon";
  return null;
}

/** Whole days between a past due date and today (0 when not late). */
export function daysLate(due: IsoDate, today: IsoDate): number {
  return Math.max(0, Math.round((parseIsoDate(today).getTime() - parseIsoDate(due).getTime()) / 86_400_000));
}

/** A client's payment status: from its pending requests, or set by hand. "none": no open request to judge. */
export type ClientPaymentState = "late" | "due_soon" | "on_track" | "none";

export const CLIENT_PAYMENT_LABELS: Record<ClientPaymentState, string> = {
  late: "Late",
  due_soon: "Due soon",
  on_track: "On track",
  none: "No open invoice",
};

/**
 * A client's payment status from its open (pending) requests: late if any is
 * late, else due soon if any is, else on track; none without open requests.
 * A status set by hand wins.
 */
export function clientPaymentState(dueStates: (DueState | null)[], manual?: Exclude<ClientPaymentState, "none"> | null): ClientPaymentState {
  if (manual) return manual;
  if (dueStates.includes("late")) return "late";
  if (dueStates.includes("due_soon")) return "due_soon";
  return dueStates.length ? "on_track" : "none";
}

/** Overdue: past due and not Done. */
export function isOverdue(task: { dueDate: IsoDate | null; status: string }, today: IsoDate): boolean {
  return Boolean(task.dueDate && task.dueDate < today && task.status !== "done");
}

export type RiskKind = "overdue" | "blocked" | "no_owner";

/**
 * Why a task is at risk (§1.3: overdue, blocked or without an owner), the
 * first reason only so a task is listed once. Null when it's fine.
 */
export function taskRisk(task: { dueDate: IsoDate | null; status: string; ownerId: string | null }, today: IsoDate): RiskKind | null {
  if (task.status === "done") return null;
  if (isOverdue(task, today)) return "overdue";
  if (task.status === "blocked") return "blocked";
  if (!task.ownerId) return "no_owner";
  return null;
}

/**
 * Share of completed tasks (with a due date) finished on or before it, in
 * percent. `completedOn` is the completion day in the owner's time zone.
 * Null when nothing with a due date was completed.
 */
export function onTimeRate(tasks: { dueDate: IsoDate | null; completedOn: IsoDate | null }[]): number | null {
  const scored = tasks.filter((t) => t.dueDate && t.completedOn);
  if (scored.length === 0) return null;
  const onTime = scored.filter((t) => t.completedOn! <= t.dueDate!).length;
  return Math.round((onTime / scored.length) * 100);
}

/** Header greeting from the viewer's wall-clock "HH:MM". */
export function greeting(time: string): string {
  const hour = Number(time.slice(0, 2));
  if (hour < 11) return "Good morning";
  if (hour < 15) return "Good afternoon";
  if (hour < 19) return "Good evening";
  return "Good night";
}

// ---------------------------------------------------------------------------
// Designer & Developer KPI period
// ---------------------------------------------------------------------------

export const WORK_PERIODS = ["week", "month", "3m", "6m"] as const;
export type WorkPeriodKind = (typeof WORK_PERIODS)[number];

export const WORK_PERIOD_LABELS: Record<WorkPeriodKind, string> = { week: "This week", month: "This month", "3m": "Last 3 months", "6m": "Last 6 months" };
/** How the change line names the comparison window. */
export const WORK_PERIOD_PREVIOUS: Record<WorkPeriodKind, string> = { week: "last week", month: "last month", "3m": "previous 3 months", "6m": "previous 6 months" };

export type WorkBucket = { start: IsoDate; end: IsoDate; label: string };
export type WorkPeriod = { kind: WorkPeriodKind; start: IsoDate; end: IsoDate; prev: { start: IsoDate; end: IsoDate }; buckets: WorkBucket[] };

const DAY = 86_400_000;
const daysBetween = (a: IsoDate, b: IsoDate) => Math.round((parseIsoDate(b).getTime() - parseIsoDate(a).getTime()) / DAY);
const fmt = (opts: Intl.DateTimeFormatOptions) => {
  const f = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" });
  return (d: IsoDate) => f.format(parseIsoDate(d));
};
const weekday = fmt({ weekday: "short" });
const dayMonth = fmt({ day: "numeric", month: "short" });
const month = fmt({ month: "short" });

/** `?period=` → a known period, else this week. */
export function parseWorkPeriodKind(value: string | string[] | undefined): WorkPeriodKind {
  return (WORK_PERIODS as readonly string[]).includes(typeof value === "string" ? value : "") ? (value as WorkPeriodKind) : "week";
}

/**
 * The window a Designer & Developer's KPIs cover, up to today. The previous
 * window is the same number of days from the start of the period before
 * (this week so far vs last week so far), and the chart buckets are days for
 * a week, weeks for a month, months beyond that.
 */
export function resolveWorkPeriod(kind: WorkPeriodKind, today: IsoDate): WorkPeriod {
  let start: IsoDate;
  let prevStart: IsoDate;
  let buckets: WorkBucket[];
  if (kind === "week") {
    start = weekStart(today);
    prevStart = addDays(start, -7);
    buckets = Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((d) => ({ start: d, end: d, label: weekday(d) }));
  } else if (kind === "month") {
    start = monthStart(today);
    prevStart = addMonths(start, -1);
    const end = addDays(addMonths(start, 1), -1);
    buckets = [];
    for (let w = weekStart(start); w <= end; w = addDays(w, 7)) {
      const b = w < start ? start : w;
      buckets.push({ start: b, end: addDays(w, 6) > end ? end : addDays(w, 6), label: dayMonth(b) });
    }
  } else {
    const n = kind === "3m" ? 3 : 6;
    start = addMonths(monthStart(today), -(n - 1));
    prevStart = addMonths(start, -n);
    buckets = Array.from({ length: n }, (_, i) => addMonths(start, i)).map((m) => ({ start: m, end: addDays(addMonths(m, 1), -1), label: month(m) }));
  }
  return { kind, start, end: today, prev: { start: prevStart, end: addDays(prevStart, daysBetween(start, today)) }, buckets };
}

// ---------------------------------------------------------------------------
// Project status on the PM dashboard
// ---------------------------------------------------------------------------

export type ProjectStanding = "on_track" | "at_risk" | "delayed";
export const PROJECT_STANDINGS: ProjectStanding[] = ["delayed", "at_risk", "on_track"];

/**
 * Where a running project stands: delayed once it's past its end date or has
 * overdue tasks; at risk when the budget is at a warning or over, a task is
 * blocked, it's on hold, or it ends within `soon` days with open tasks left;
 * on track otherwise. The reasons say why, most serious first.
 */
export function projectStanding(
  p: {
    status: "active" | "on_hold";
    endDate: IsoDate | null;
    health: "on_track" | "warning" | "over_budget" | "no_budget";
    overdueTasks: number;
    blockedTasks: number;
    openTasks: number;
  },
  today: IsoDate,
  soon = 7,
): { standing: ProjectStanding; reasons: string[] } {
  const delayed: string[] = [];
  const risk: string[] = [];
  if (p.endDate && p.endDate < today) delayed.push(`Past end date by ${daysLate(p.endDate, today)}d`);
  if (p.overdueTasks) delayed.push(`${p.overdueTasks} overdue ${p.overdueTasks === 1 ? "task" : "tasks"}`);
  if (p.health === "over_budget") risk.push("Over budget");
  else if (p.health === "warning") risk.push("Budget warning");
  if (p.blockedTasks) risk.push(`${p.blockedTasks} blocked`);
  if (p.status === "on_hold") risk.push("On hold");
  if (p.endDate && p.endDate >= today && p.endDate <= addDays(today, soon) && p.openTasks) risk.push(`Ends soon with ${p.openTasks} open`);
  return { standing: delayed.length ? "delayed" : risk.length ? "at_risk" : "on_track", reasons: [...delayed, ...risk] };
}

/** Percent of capacity spent on billable work; null without capacity (Metric Dictionary). */
export function utilizationPct(billableMinutes: number, capacityHours: number): number | null {
  return metricUtilization(billableMinutes / 60, capacityHours);
}
