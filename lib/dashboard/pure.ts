import { fromMinor, toMinor } from "@/lib/invoices/pure";
import { addDays, parseIsoDate, type IsoDate } from "@/lib/time/pure";

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
