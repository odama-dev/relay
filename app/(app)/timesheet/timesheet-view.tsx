"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import type { EntryView, Timesheet } from "@/lib/time/queries";
import { addDays, weekStart } from "@/lib/time/pure";
import { formatDate, formatDuration, formatHours, formatWeekday, formatRelative } from "@/lib/format";
import { useOpenFromUrl } from "@/lib/hooks/use-open-from-url";
import { deleteEntry } from "./actions";
import { LogTimeDialog, type EntryDraft } from "@/components/time/log-time-dialog";
import { Button } from "@/components/ui/button";
import { PillButton } from "@/components/pill-button";
import { RowActions } from "@/components/row-actions";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

type Dialog = { mode: "create" | "edit" | "correct" | "add-correction"; initial?: EntryDraft } | null;

const draftOf = (e: EntryView): EntryDraft => ({
  id: e.id,
  entryDate: e.entryDate,
  minutes: e.minutes,
  taskId: e.taskId,
  categoryId: e.categoryId,
  note: e.note,
  outOfScope: e.oosStatus === "pending" || e.oosStatus === "approved",
});

/** M3.4 — the week Monday–Sunday: totals per day and week, empty workdays flagged. */
export function TimesheetView({ sheet }: { sheet: Timesheet }) {
  const router = useRouter();
  const pathname = usePathname();
  const [createOpen, setCreateOpen] = useOpenFromUrl();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [deleting, setDeleting] = useState<EntryView | null>(null);
  const thisWeek = weekStart(sheet.today);
  const go = (week: string) => router.push(week === thisWeek ? pathname : `${pathname}?week=${week}`);
  const missing = sheet.days.filter((d) => d.missing).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Previous week" onClick={() => go(addDays(sheet.weekStart, -7))}>
            <Icon name="chevronLeft" size={16} />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Next week" disabled={sheet.weekStart >= thisWeek} onClick={() => go(addDays(sheet.weekStart, 7))}>
            <Icon name="chevronRight" size={16} />
          </Button>
        </div>
        <h2 className="text-title font-medium">
          {formatDate(sheet.weekStart)} – {formatDate(addDays(sheet.weekStart, 6))}
        </h2>
        {sheet.locked && <StatusBadge value="archived" label="Locked" />}
        {sheet.weekStart !== thisWeek && (
          <Button variant="ghost" size="sm" onClick={() => go(thisWeek)}>
            This week
          </Button>
        )}
        <span className="flex-1" />
        <span className="text-body">
          <span className="text-muted-foreground">Week total </span>
          <span className="tabular font-medium">{formatHours(sheet.totalMinutes)}</span>
        </span>
        {sheet.locked ? (
          <PillButton icon="add" variant="tertiary" onClick={() => setDialog({ mode: "add-correction", initial: { entryDate: sheet.weekStart } })}>
            Add forgotten time
          </PillButton>
        ) : (
          <PillButton icon="time" onClick={() => setCreateOpen(true)}>
            Log time
          </PillButton>
        )}
      </div>

      {sheet.locked && (
        <p className="text-muted-foreground text-body">
          This week was locked automatically on Monday. Changes go through a correction request reviewed by the project&apos;s PM (or HR for non-billable time).
        </p>
      )}
      {sheet.mustLog && missing > 0 && !sheet.locked && (
        <p className="text-warning text-body">
          {missing} workday{missing === 1 ? "" : "s"} without time this week.
        </p>
      )}

      <div className="bleed grid grid-cols-7 border-y border-black/6 py-3 dark:border-white/8" aria-label="Hours per day">
        {sheet.days.map((d, i) => (
          <div
            key={d.date}
            className={cn(
              "relative flex items-center justify-center gap-2 px-1 text-subtitle",
              // Short divider between days, not full height.
              i > 0 && "before:absolute before:top-1/2 before:left-0 before:h-4 before:w-px before:-translate-y-1/2 before:bg-black/8 dark:before:bg-white/10",
              !d.workday && "opacity-60",
            )}
          >
            <span className="text-foreground/70 font-medium">{formatWeekday(d.date).split(" ")[0]}</span>
            <span
              aria-current={d.date === sheet.today ? "date" : undefined}
              className={cn(
                "tabular grid size-7 place-items-center rounded-full text-body",
                d.date === sheet.today ? "bg-foreground text-background" : "text-foreground/70",
              )}
            >
              {Number(d.date.slice(8))}
            </span>
            <span className="bg-foreground/25 size-[3px] rounded-full" aria-hidden />
            <span className={cn("tabular text-muted-foreground text-body", d.minutes > 0 && "text-foreground", d.missing && sheet.mustLog && "text-warning")}>
              {d.minutes ? formatHours(d.minutes) : d.missing && sheet.mustLog ? "Missing" : "—"}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-5">
        {sheet.days
          .filter((d) => d.entries.length > 0 || (d.missing && sheet.mustLog))
          .map((d) => (
            <section key={d.date} className="flex flex-col gap-1">
              <h3 className="flex items-baseline gap-2 px-1 text-body font-medium">
                {formatWeekday(d.date)}
                <span className="text-muted-foreground tabular text-caption font-normal">{formatHours(d.minutes)}</span>
                {d.missing && sheet.mustLog && <span className="text-warning text-caption font-normal">No time logged</span>}
                {!sheet.locked && (
                  <Button variant="ghost" size="compact" className="ml-auto" onClick={() => setDialog({ mode: "create", initial: { entryDate: d.date } })}>
                    <Icon name="add" size={12} />
                    Add
                  </Button>
                )}
              </h3>
              {d.entries.length > 0 && (
                <ul className="flex flex-col divide-y divide-black/4 dark:divide-white/5">
                  {d.entries.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-body">
                      <span className="tabular w-16 shrink-0 font-medium">{formatDuration(e.minutes)}</span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">
                          {e.taskTitle ?? e.categoryName}
                          {e.projectCode && <span className="text-muted-foreground"> · {e.projectCode}</span>}
                        </span>
                        {e.note && <span className="text-muted-foreground truncate text-caption">{e.note}</span>}
                      </span>
                      {e.oosStatus !== "none" && <StatusBadge value={e.oosStatus} label={`Out of scope · ${e.oosStatus}`} />}
                      {!e.isBillable && <span className="text-muted-foreground hidden text-caption sm:inline">Non-billable</span>}
                      {e.pendingCorrection && <StatusBadge value="pending" label="Correction pending" />}
                      <RowActions
                        label={`Actions for this entry`}
                        actions={
                          sheet.locked
                            ? [{ label: "Request correction", icon: "edit", hidden: e.pendingCorrection, onSelect: () => setDialog({ mode: "correct", initial: draftOf(e) }) }]
                            : [
                                { label: "Edit", icon: "edit", onSelect: () => setDialog({ mode: "edit", initial: draftOf(e) }) },
                                { label: "Delete", icon: "delete", destructive: true, onSelect: () => setDeleting(e) },
                              ]
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
      </div>

      {sheet.corrections.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-body font-medium">Your correction requests</h3>
          <ul className="flex flex-col gap-1 text-body">
            {sheet.corrections.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <StatusBadge value={c.status} />
                <span>{c.summary}</span>
                <span className="text-muted-foreground">— {c.reason}</span>
                {c.reviewNote && <span className="text-muted-foreground">· “{c.reviewNote}”</span>}
                <span className="text-muted-foreground text-caption">{formatRelative(c.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {createOpen && <LogTimeDialog open onOpenChange={setCreateOpen} />}
      {dialog && <LogTimeDialog open mode={dialog.mode} initial={dialog.initial} onOpenChange={(o) => !o && setDialog(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this entry?"
        description={deleting ? `${formatDuration(deleting.minutes)} on ${formatDate(deleting.entryDate)}.` : undefined}
        confirmLabel="Delete entry"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteEntry(deleting.id);
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          toast.success("Entry deleted");
          router.refresh();
        }}
      />
    </div>
  );
}
