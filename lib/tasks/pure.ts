import { addDays, isoWeekday, type IsoDate } from "@/lib/time/pure";
import { metricWeek } from "@/lib/metrics/pure";

/**
 * Task timing (PRD Phase 2 "Aturan Task on Time"): a task is done when it's
 * approved; review rounds have a one-working-day SLA and the reviewer's
 * delay beyond it moves the due date ("effective due"); a due date change
 * counts only when the PM approved it before the due date passed.
 */

export type Calendar = { workdays: number[]; holidays: ReadonlySet<IsoDate> };

const isWorkday = (d: IsoDate, cal: Calendar) => cal.workdays.includes(isoWeekday(d)) && !cal.holidays.has(d);

/** Working days in (from, to] — 0 when `to` isn't after `from`. */
export function workdaysAfter(from: IsoDate, to: IsoDate, cal: Calendar): number {
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isWorkday(d, cal)) n++;
  return n;
}

/** `d` moved forward by `n` working days (a weekend or holiday due date first rolls to nothing — it stays). */
export function addWorkdays(d: IsoDate, n: number, cal: Calendar): IsoDate {
  let out = d;
  for (let left = n; left > 0; ) {
    out = addDays(out, 1);
    if (isWorkday(out, cal)) left--;
  }
  return out;
}

/** A review round in local days: when the SLA ran out and when it was decided (null = still open). */
export type Round = { slaDueOn: IsoDate; decidedOn: IsoDate | null };

/** The reviewer's working days past the SLA, summed over every round (open rounds count up to `today`). */
export function reviewerDelay(rounds: Round[], today: IsoDate, cal: Calendar): number {
  return rounds.reduce((n, r) => n + workdaysAfter(r.slaDueOn, r.decidedOn ?? today, cal), 0);
}

/** A due date change in local days. Only approved ones can count. */
export type DueChange = { toDate: IsoDate; approvedOn: IsoDate | null };

/**
 * The due date that counts: the first due date, moved by each approved
 * change that was approved on or before the due date then in force.
 */
export function agreedDue(first: IsoDate, changes: DueChange[]): IsoDate {
  let due = first;
  for (const c of [...changes].filter((c) => c.approvedOn).sort((a, b) => a.approvedOn!.localeCompare(b.approvedOn!))) {
    if (c.approvedOn! <= due) due = c.toDate;
  }
  return due;
}

export type TaskTiming = {
  /** The first due date (locked); falls back to the current one for old tasks. */
  firstDue: IsoDate | null;
  changes: DueChange[];
  rounds: Round[];
  /** Local day the reviewer approved it; null while open. */
  approvedOn: IsoDate | null;
};

/** Effective due = agreed due + the reviewer's delay beyond the SLA. Null without a due date. */
export function effectiveDue(t: TaskTiming, today: IsoDate, cal: Calendar): IsoDate | null {
  if (!t.firstDue) return null;
  return addWorkdays(agreedDue(t.firstDue, t.changes), reviewerDelay(t.rounds, today, cal), cal);
}

/** On time: approved on or before the effective due. Null when it can't be scored (no due date, not approved). */
export function isOnTime(t: TaskTiming, today: IsoDate, cal: Calendar): boolean | null {
  const due = effectiveDue(t, today, cal);
  if (!due || !t.approvedOn) return null;
  return t.approvedOn <= due;
}

/** Overdue: not approved and the effective due has passed. */
export function isOverdueTiming(t: TaskTiming, today: IsoDate, cal: Calendar): boolean {
  const due = effectiveDue(t, today, cal);
  return Boolean(due && !t.approvedOn && due < today);
}

/**
 * Task on Time score (KPI): per week, tasks approved on time ÷ tasks whose
 * effective due falls in that week (a task still open after its week counts
 * as late); the period score is the average of the weekly scores. Weeks in
 * `skipWeeks` (fully on leave or holiday) and weeks with nothing due aren't
 * counted. Null when no week counts.
 */
export function onTimeScore(
  tasks: TaskTiming[],
  window: { start: IsoDate; end: IsoDate },
  today: IsoDate,
  cal: Calendar,
  skipWeeks: ReadonlySet<IsoDate> = new Set(),
): { score: number | null; weeks: { start: IsoDate; due: number; onTime: number; pct: number }[] } {
  const byWeek = new Map<IsoDate, { due: number; onTime: number }>();
  for (const t of tasks) {
    const due = effectiveDue(t, today, cal);
    if (!due || due < window.start || due > window.end) continue;
    const { start } = metricWeek(due);
    // Not yet scorable: still open and its due date hasn't passed.
    if (!t.approvedOn && due >= today) continue;
    if (skipWeeks.has(start)) continue;
    const w = byWeek.get(start) ?? { due: 0, onTime: 0 };
    w.due++;
    if (t.approvedOn && t.approvedOn <= due) w.onTime++;
    byWeek.set(start, w);
  }
  const weeks = [...byWeek]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, w]) => ({ start, ...w, pct: Math.round((w.onTime / w.due) * 1000) / 10 }));
  const score = weeks.length ? Math.round((weeks.reduce((s, w) => s + w.pct, 0) / weeks.length) * 10) / 10 : null;
  return { score, weeks };
}
