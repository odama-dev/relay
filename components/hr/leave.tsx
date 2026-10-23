"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { LEAVE_KIND_LABELS } from "@/lib/hr/pure";
import type { LeaveRequestRow } from "@/lib/hr/queries";
import { LEAVE_KINDS, leaveRequestSchema, type LeaveRequestInput } from "@/lib/validation";
import { formatDate, formatDateShort } from "@/lib/format";
import { cancelLeave, decideLeave, requestLeave } from "@/app/(app)/hr/actions";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormField, fieldA11y } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { CheckField } from "@/components/check-field";
import { DatePicker } from "@/components/date-picker";
import { CardGroupLabel, CardList, cardRowClass, panelSection, panelSections } from "@/components/dashboard-card";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { icons } from "@/components/icon";

/** "3 – 5 Nov" / "3 Nov (half day)". */
export function leaveDates(r: Pick<LeaveRequestRow, "startDate" | "endDate" | "halfDay">) {
  if (r.startDate === r.endDate) return `${formatDateShort(r.startDate)}${r.halfDay ? " (half day)" : ""}`;
  return `${formatDateShort(r.startDate)} – ${formatDateShort(r.endDate)}`;
}

// ---------------------------------------------------------------------------
// HR: decide, and who's away
// ---------------------------------------------------------------------------

/** Requests waiting for HR, then leave booked for the next 30 days. Sized for a narrow card. */
export function LeaveOverview({ pending, upcoming, viewerId }: { pending: LeaveRequestRow[]; upcoming: LeaveRequestRow[]; viewerId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<LeaveRequestRow | null>(null);
  const [note, setNote] = useState("");

  const decide = async (id: string, decision: "approved" | "rejected", reason?: string) => {
    setBusy(id);
    const res = await decideLeave({ id, decision, note: reason });
    setBusy(null);
    if (!res.ok) return void toast.error(res.error);
    toast.success(decision === "approved" ? "Leave approved" : "Leave rejected");
    router.refresh();
  };

  return (
    <div className={panelSections}>
      <div className={panelSection}>
        <CardGroupLabel label="Waiting for you" count={pending.length || undefined} tone={pending.length ? "warning" : undefined} />
        {pending.length === 0 ? (
          <p className="text-muted-foreground py-1 text-body">No requests waiting.</p>
        ) : (
          <CardList>
            {pending.map((r) => (
              <li key={r.id} className={cn(cardRowClass, "flex-col items-stretch gap-1.5 py-2")}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">
                    {r.person.name} <span className="text-muted-foreground">· {LEAVE_KIND_LABELS[r.kind]}</span>
                  </span>
                  <span className="text-muted-foreground truncate text-caption">
                    {leaveDates(r)}
                    {r.reason && ` · ${r.reason}`}
                  </span>
                </span>
                {r.person.id === viewerId ? (
                  <span className="text-muted-foreground text-caption">Another HR person decides</span>
                ) : (
                  <span className="flex justify-end gap-1">
                    <Button size="compact" variant="ghost" disabled={busy === r.id} onClick={() => setRejecting(r)}>
                      Reject
                    </Button>
                    <Button size="compact" variant="tertiary" leadingIcon={icons.check} disabled={busy === r.id} onClick={() => decide(r.id, "approved")}>
                      Approve
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </CardList>
        )}
      </div>
      <AwayList label="Next 30 days" rows={upcoming} empty="No leave booked." />

      <Dialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent className="sm:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!rejecting) return;
              await decide(rejecting.id, "rejected", note || undefined);
              setRejecting(null);
              setNote("");
            }}
          >
            <DialogHeader>
              <DialogTitle>Reject {rejecting?.person.name}&apos;s request</DialogTitle>
              <DialogDescription>{rejecting && `${LEAVE_KIND_LABELS[rejecting.kind]} · ${leaveDates(rejecting)}`}</DialogDescription>
            </DialogHeader>
            <FormField label="Note for them" htmlFor="leave-note" hint="Optional — sent with the decision.">
              <Textarea id="leave-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="tertiary" onClick={() => setRejecting(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy !== null}>
                Reject request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AwayList({ label, rows, empty }: { label: string; rows: LeaveRequestRow[]; empty: string }) {
  return (
    <div className={panelSection}>
      <CardGroupLabel label={label} count={rows.length || undefined} />
      {rows.length === 0 ? (
        <p className="text-muted-foreground py-1 text-body">{empty}</p>
      ) : (
        <CardList>
          {rows.map((r) => (
            <li key={r.id} className={cn(cardRowClass, "py-1.5")}>
              <span className="min-w-0 flex-1 truncate">
                {r.person.name} <span className="text-muted-foreground">· {LEAVE_KIND_LABELS[r.kind]}</span>
              </span>
              <span className="text-muted-foreground tabular shrink-0 whitespace-nowrap text-caption">{leaveDates(r)}</span>
            </li>
          ))}
        </CardList>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members: ask, and follow your own requests
// ---------------------------------------------------------------------------

export function LeaveRequestDialog({ open, onOpenChange, today }: { open: boolean; onOpenChange: (open: boolean) => void; today: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open && <LeaveForm today={today} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function LeaveForm({ today, onDone }: { today: string; onDone: () => void }) {
  const router = useRouter();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LeaveRequestInput>({ resolver: zodResolver(leaveRequestSchema), defaultValues: { kind: "annual_leave", startDate: today, endDate: today, halfDay: false, reason: "" } });
  const [startDate, endDate] = useWatch({ control, name: ["startDate", "endDate"] });
  const oneDay = startDate === endDate;

  const onSubmit = handleSubmit(async (values) => {
    const res = await requestLeave({ ...values, halfDay: oneDay && values.halfDay });
    if (!res.ok) return void toast.error(res.error);
    toast.success("Request sent to HR");
    onDone();
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Request leave</DialogTitle>
        <DialogDescription>HR gets a message and decides; you&apos;ll hear back here and on Slack.</DialogDescription>
      </DialogHeader>
      <FormField label="Type" htmlFor="lv-kind" required>
        <Controller control={control} name="kind" render={({ field }) => <SelectField id="lv-kind" value={field.value} onChange={field.onChange} options={LEAVE_KINDS.map((k) => ({ value: k, label: LEAVE_KIND_LABELS[k] }))} />} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="From" htmlFor="lv-start" required error={errors.startDate?.message}>
          <Controller control={control} name="startDate" render={({ field }) => <DatePicker id="lv-start" value={field.value} onChange={field.onChange} />} />
        </FormField>
        <FormField label="Until" htmlFor="lv-end" required error={errors.endDate?.message}>
          <Controller control={control} name="endDate" render={({ field }) => <DatePicker id="lv-end" value={field.value} onChange={field.onChange} />} />
        </FormField>
      </div>
      {oneDay && <Controller control={control} name="halfDay" render={({ field }) => <CheckField id="lv-half" checked={field.value ?? false} onChange={field.onChange} label="Half day" />} />}
      <FormField label="Reason" htmlFor="lv-reason" error={errors.reason?.message}>
        <Textarea rows={2} {...fieldA11y("lv-reason", errors.reason?.message)} {...register("reason")} />
      </FormField>
      <DialogFooter>
        <Button type="button" variant="tertiary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Sending…" : "Send request"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Your requests with their status; pending or approved ones can be cancelled. */
export function MyLeave({ rows, today }: { rows: LeaveRequestRow[]; today: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [cancelling, setCancelling] = useState<LeaveRequestRow | null>(null);
  return (
    <section aria-label="My leave" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-subtitle font-semibold">My leave</h2>
        <Button size="compact" variant="secondary" leadingIcon={icons.add} onClick={() => setAsking(true)}>
          Request leave
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-body">No leave requests yet.</p>
      ) : (
        <CardList>
          {rows.map((r) => (
            <li key={r.id} className={cn(cardRowClass, "items-start py-2")}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">
                  {LEAVE_KIND_LABELS[r.kind]} <span className="text-muted-foreground tabular">· {leaveDates(r)}</span>
                </span>
                {(r.decisionNote || r.reason) && (
                  <span className="text-muted-foreground truncate text-caption">{r.decisionNote ? `${r.decidedBy ?? "HR"}: ${r.decisionNote}` : r.reason}</span>
                )}
              </span>
              <StatusBadge value={r.status} className="shrink-0" />
              {(r.status === "pending" || (r.status === "approved" && r.endDate >= today)) && (
                <Button size="compact" variant="ghost" className="shrink-0" onClick={() => setCancelling(r)}>
                  Cancel
                </Button>
              )}
            </li>
          ))}
        </CardList>
      )}
      <LeaveRequestDialog open={asking} onOpenChange={setAsking} today={today} />
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this leave request?"
        description={cancelling ? `${LEAVE_KIND_LABELS[cancelling.kind]} · ${formatDate(cancelling.startDate)}${cancelling.status === "approved" ? " — it's already approved; your hours come back." : ""}` : undefined}
        confirmLabel="Cancel request"
        cancelLabel="Keep it"
        onConfirm={async () => {
          if (!cancelling) return;
          const res = await cancelLeave(cancelling.id);
          if (!res.ok) return void toast.error(res.error);
          toast.success("Request cancelled");
          setCancelling(null);
          router.refresh();
        }}
      />
    </section>
  );
}
