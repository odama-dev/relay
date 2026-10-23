import type { AttendanceStatus, HrEventColor, HrEventRecurrence, LeaveKind } from "@prisma/client";
import { addDays, addMonths, isoWeekday, monthStart, parseIsoDate, type IsoDate } from "@/lib/time/pure";

/**
 * HR rules — pure, so the calendar, the dashboard and the tests share one
 * definition: how repeating events unfold, how a month grid lays them out,
 * what a person's day looks like and how loaded their week is.
 */

// ---------------------------------------------------------------------------
// Repeating events
// ---------------------------------------------------------------------------

export type HrEventInput = {
  id: string;
  title: string;
  notes: string | null;
  color: HrEventColor;
  startDate: IsoDate;
  endDate: IsoDate;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  recurrence: HrEventRecurrence;
  repeatUntil: IsoDate | null;
};

export type HrExceptionInput = {
  eventId: string;
  occurrenceDate: IsoDate;
  cancelled: boolean;
  title: string | null;
  notes: string | null;
  color: HrEventColor | null;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  allDay: boolean | null;
  startTime: string | null;
  endTime: string | null;
};

export type HrOccurrence = Omit<HrEventInput, "recurrence" | "repeatUntil" | "id"> & {
  /** `${eventId}:${occurrenceDate}` — stable across renders. */
  key: string;
  eventId: string;
  /** The start date the series gives this occurrence (the exception key). */
  occurrenceDate: IsoDate;
  recurrence: HrEventRecurrence;
  /** Changed on its own ("only this one"). */
  edited: boolean;
};

const DAY_MS = 86_400_000;
export const daysBetween = (a: IsoDate, b: IsoDate) => Math.round((parseIsoDate(b).getTime() - parseIsoDate(a).getTime()) / DAY_MS);
const lastDay = (month: IsoDate) => addDays(addMonths(month, 1), -1);

/** The n-th start of a series: every 7 days, or the same day each month (the 31st falls on a short month's last day). */
export function nthStart(e: Pick<HrEventInput, "startDate" | "recurrence">, n: number): IsoDate {
  if (e.recurrence === "weekly") return addDays(e.startDate, 7 * n);
  if (e.recurrence === "monthly") {
    const month = addMonths(monthStart(e.startDate), n);
    const day = Number(e.startDate.slice(8, 10));
    const end = lastDay(month);
    return Number(end.slice(8, 10)) < day ? end : `${month.slice(0, 8)}${String(day).padStart(2, "0")}`;
  }
  return e.startDate;
}

/**
 * Every occurrence touching [from, to], with "only this one" changes applied
 * and skipped ones left out. Each keeps the series' length in days.
 */
export function expandEvents(events: HrEventInput[], exceptions: HrExceptionInput[], from: IsoDate, to: IsoDate): HrOccurrence[] {
  const byKey = new Map(exceptions.map((x) => [`${x.eventId}:${x.occurrenceDate}`, x]));
  const out: HrOccurrence[] = [];
  for (const e of events) {
    const length = daysBetween(e.startDate, e.endDate);
    for (let n = 0; ; n++) {
      const start = nthStart(e, n);
      if (start > to || (e.repeatUntil && start > e.repeatUntil) || (n > 0 && e.recurrence === "none")) break;
      const key = `${e.id}:${start}`;
      const x = byKey.get(key);
      if (x?.cancelled) continue;
      const occ: HrOccurrence = {
        key,
        eventId: e.id,
        occurrenceDate: start,
        recurrence: e.recurrence,
        edited: Boolean(x),
        title: x?.title ?? e.title,
        notes: x ? x.notes : e.notes,
        color: x?.color ?? e.color,
        startDate: x?.startDate ?? start,
        endDate: x?.endDate ?? addDays(start, length),
        allDay: x?.allDay ?? e.allDay,
        startTime: x && x.allDay !== null ? x.startTime : e.startTime,
        endTime: x && x.allDay !== null ? x.endTime : e.endTime,
      };
      if (occ.endDate >= from && occ.startDate <= to) out.push(occ);
    }
  }
  return out.sort((a, b) => a.startDate.localeCompare(b.startDate) || Number(b.allDay) - Number(a.allDay) || (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------------
// Month grid
// ---------------------------------------------------------------------------

export type GridItem = { key: string; startDate: IsoDate; endDate: IsoDate };
export type WeekSegment<T> = {
  item: T;
  /** 0–6 within the week. */
  col: number;
  span: number;
  lane: number;
  /** The item started before / continues after this week. */
  continuesBefore: boolean;
  continuesAfter: boolean;
};
export type MonthWeek<T> = { days: IsoDate[]; segments: WeekSegment<T>[] };

/** The Sunday on or before `d` (the calendar's weeks start on Sunday). */
export const sundayOf = (d: IsoDate) => addDays(d, -(isoWeekday(d) % 7));

/**
 * A month as whole Sunday-first weeks, each item cut into one segment per week
 * and stacked into the first free lane — longer items first, so multi-day bars
 * stay on top and line up across the days they cover.
 */
export function layoutMonth<T extends GridItem>(month: IsoDate, items: T[]): MonthWeek<T>[] {
  const first = sundayOf(monthStart(month));
  const last = addDays(sundayOf(lastDay(month)), 6);
  const weeks: MonthWeek<T>[] = [];
  for (let start = first; start <= last; start = addDays(start, 7)) weeks.push(layoutWeek(start, items));
  return weeks;
}

/** One Sunday-first week: each item touching it cut to the week and stacked into the first free lane. */
export function layoutWeek<T extends GridItem>(start: IsoDate, items: T[]): MonthWeek<T> {
  const end = addDays(start, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const inWeek = items
    .filter((it) => it.endDate >= start && it.startDate <= end)
    .map((item) => {
      const s = item.startDate < start ? start : item.startDate;
      const e = item.endDate > end ? end : item.endDate;
      return { item, col: daysBetween(start, s), span: daysBetween(s, e) + 1, continuesBefore: item.startDate < start, continuesAfter: item.endDate > end };
    })
    .sort((a, b) => b.span - a.span || a.col - b.col);
  const lanes: boolean[][] = [];
  const segments = inWeek.map((seg) => {
    let lane = 0;
    while (lanes[lane]?.slice(seg.col, seg.col + seg.span).some(Boolean)) lane++;
    lanes[lane] ??= Array(7).fill(false);
    for (let c = seg.col; c < seg.col + seg.span; c++) lanes[lane]![c] = true;
    return { ...seg, lane };
  });
  return { days, segments };
}

// ---------------------------------------------------------------------------
// Week time grid
// ---------------------------------------------------------------------------

/** "09:30" → 570. */
export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export type TimedBlock<T> = { item: T; start: number; end: number; col: number; cols: number };

/**
 * One day's timed events as blocks (minutes from midnight) laid side by side
 * where they overlap: each block takes the first free column of its cluster
 * of overlapping events, and every block in a cluster shares its width.
 */
export function layoutDay<T>(items: { item: T; start: number; end: number }[]): TimedBlock<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: TimedBlock<T>[] = [];
  let cluster: TimedBlock<T>[] = [];
  let clusterEnd = -1;
  const close = () => {
    const cols = Math.max(1, ...cluster.map((b) => b.col + 1));
    for (const b of cluster) b.cols = cols;
    out.push(...cluster);
    cluster = [];
  };
  for (const it of sorted) {
    if (cluster.length && it.start >= clusterEnd) close();
    const taken = new Set(cluster.filter((b) => b.end > it.start).map((b) => b.col));
    let col = 0;
    while (taken.has(col)) col++;
    cluster.push({ ...it, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) close();
  return out;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export type DayStatus = "present" | "remote" | "not_checked_in" | "annual_leave" | "permit" | "sick" | "other_leave" | "off";

export const LEAVE_KIND_LABELS: Record<LeaveKind, string> = { annual_leave: "Annual leave", permit: "Permit", sick: "Sick", other: "Other leave" };

/**
 * Today for one person (PRD Phase 2: attendance, not logged hours): time off
 * wins, then their check-in; a holiday or non-workday without a check-in is
 * a day off.
 */
export function dayStatus({ leave, attendance, workday }: { leave: LeaveKind | null; attendance: AttendanceStatus | null; workday: boolean }): DayStatus {
  if (leave) return leave === "other" ? "other_leave" : leave;
  if (attendance === "present" || attendance === "remote") return attendance;
  if (attendance === "off" || !workday) return "off";
  return "not_checked_in";
}

/** Open work against capacity — defined once in the Metric Dictionary. */
export { workloadPct } from "@/lib/metrics/pure";

/** Workdays in [from, to] (ISO weekdays 1–7), for a leave's length. */
export function workdaysIn(from: IsoDate, to: IsoDate, workdays: number[]): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (workdays.includes(isoWeekday(d))) n++;
  return n;
}
