import "server-only";
import type { Tx } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { isoDate, todayIn, type IsoDate } from "@/lib/time/pure";
import { effectiveDue, type Calendar, type TaskTiming } from "@/lib/tasks/pure";

/** Working days and public holidays (read in the caller's RLS transaction). */
export async function workCalendar(tx: Tx): Promise<Calendar> {
  const [settings, holidays] = await Promise.all([getSettings(), tx.publicHoliday.findMany({ select: { date: true } })]);
  return { workdays: settings.workdays, holidays: new Set(holidays.map((h) => isoDate(h.date))) };
}

type TaskDates = { id: string; dueDate: Date | null; originalDueDate: Date | null; approvedAt: Date | null; completedAt?: Date | null };

/**
 * Each task's timing inputs — first due date, due changes, review rounds,
 * approval day — in the viewer's time zone, for lib/tasks/pure.
 */
export async function taskTimings(tx: Tx, tasks: TaskDates[], timeZone: string): Promise<Map<string, TaskTiming>> {
  const ids = tasks.map((t) => t.id);
  const local = (d: Date) => todayIn(timeZone, d);
  const [rounds, changes] = ids.length
    ? await Promise.all([
        tx.reviewRound.findMany({ where: { taskId: { in: ids } }, select: { taskId: true, slaDueAt: true, decidedAt: true } }),
        tx.dueDateChange.findMany({ where: { taskId: { in: ids } }, select: { taskId: true, toDate: true, approvedAt: true } }),
      ])
    : [[], []];
  return new Map(
    tasks.map((t) => {
      // Old tasks (before Phase 2) were done without an approval stamp.
      const approved = t.approvedAt ?? t.completedAt ?? null;
      const first = t.originalDueDate ?? t.dueDate;
      const timing: TaskTiming = {
        firstDue: first ? isoDate(first) : null,
        changes: changes.filter((c) => c.taskId === t.id).map((c) => ({ toDate: isoDate(c.toDate), approvedOn: c.approvedAt ? local(c.approvedAt) : null })),
        rounds: rounds.filter((r) => r.taskId === t.id).map((r) => ({ slaDueOn: local(r.slaDueAt), decidedOn: r.decidedAt ? local(r.decidedAt) : null })),
        approvedOn: approved ? local(approved) : null,
      };
      return [t.id, timing] as const;
    }),
  );
}

/**
 * Approved tasks as on-time inputs for `onTimeRate`: the effective due date
 * and the approval day — the same rule on every dashboard.
 */
export async function onTimeInputs(tx: Tx, tasks: TaskDates[], timeZone: string, today: IsoDate) {
  const [timings, cal] = await Promise.all([taskTimings(tx, tasks, timeZone), workCalendar(tx)]);
  return new Map(
    tasks.map((t) => {
      const tm = timings.get(t.id)!;
      return [t.id, { dueDate: effectiveDue(tm, today, cal), completedOn: tm.approvedOn }] as const;
    }),
  );
}
