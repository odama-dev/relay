"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { LeaveConflict } from "@/lib/dashboard/phase2";
import { formatDate, formatDateShort } from "@/lib/format";
import { LEAVE_KIND_LABELS } from "@/lib/hr/pure";
import { cardRowClass } from "@/components/dashboard-card";
import { PillSelect } from "@/components/pill-select";
import { FormField } from "@/components/form-field";
import { DatePicker } from "@/components/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { updateTask } from "@/app/(app)/tasks/actions";
import { useOpenTask } from "./widgets";
import { cn } from "@/lib/utils";

/**
 * PRD "Cuti & kapasitas": a task due while its owner is away — the PM
 * reassigns it (it then counts for the new owner) or moves the due date
 * with a reason. No automatic backup.
 */
export function LeaveConflictRow({ c }: { c: LeaveConflict }) {
  const router = useRouter();
  const open = useOpenTask();
  const [moving, setMoving] = useState(false);
  const reassign = async (ownerId: string) => {
    const res = await updateTask(c.taskId, { ownerId });
    if (!res.ok) return void toast.error(res.error);
    toast.success("Reassigned");
    router.refresh();
  };
  return (
    <li className={cn(cardRowClass, "items-start py-2")}>
      <button type="button" onClick={() => open(c.taskId)} className="flex min-w-0 flex-1 flex-col text-left focus-visible:outline-none">
        <span className="truncate">
          <span className="text-muted-foreground tabular">{c.projectCode}</span> · {c.title}
        </span>
        <span className="text-warning text-caption">
          {c.owner.name}&apos;s task is due {formatDateShort(c.dueDate)}, while {c.owner.name} is on {LEAVE_KIND_LABELS[c.leave.kind as keyof typeof LEAVE_KIND_LABELS].toLowerCase()} {formatDateShort(c.leave.start)}
          {c.leave.end !== c.leave.start && `–${formatDateShort(c.leave.end)}`}.
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-1">
        {c.members.length > 0 && (
          <PillSelect ariaLabel="Reassign to" value="" options={[{ value: "", label: "Reassign" }, ...c.members.map((m) => ({ value: m.id, label: m.name }))]} onChange={(v) => v && void reassign(v)} />
        )}
        <Button type="button" size="sm" variant="tertiary" onClick={() => setMoving(true)}>
          Move date
        </Button>
      </span>
      {moving && <MoveDueDialog c={c} onClose={() => setMoving(false)} />}
    </li>
  );
}

function MoveDueDialog({ c, onClose }: { c: LeaveConflict; onClose: () => void }) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [reason, setReason] = useState(`${c.owner.name} is on leave`);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const res = await updateTask(c.taskId, { dueDate: date, dueReason: reason });
            setBusy(false);
            if (!res.ok) return void toast.error(res.error);
            toast.success("Due date moved");
            onClose();
            router.refresh();
          }}
        >
          <DialogHeader>
            <DialogTitle>Move “{c.title}”</DialogTitle>
            <DialogDescription>Due {formatDate(c.dueDate)}. Moved before it passes, it still counts as on time.</DialogDescription>
          </DialogHeader>
          <FormField label="New due date" htmlFor="mv-date" required>
            <DatePicker id="mv-date" value={date} onChange={setDate} className="w-full" isDayDisabled={(d) => d <= c.dueDate && d >= c.leave.start} />
          </FormField>
          <FormField label="Reason" htmlFor="mv-reason" required>
            <Textarea id="mv-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !date || !reason.trim()}>
              Move due date
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
