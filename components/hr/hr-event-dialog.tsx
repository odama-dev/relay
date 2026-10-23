"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { HrEventColor } from "@prisma/client";
import type { HrOccurrence } from "@/lib/hr/pure";
import type { HrSeries } from "@/lib/hr/queries";
import { HR_EVENT_COLORS, hrEventSchema, type HrEventInput } from "@/lib/validation";
import { createHrEvent, deleteHrEvent, updateHrEvent } from "@/app/(app)/hr/actions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, fieldA11y } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { CheckField } from "@/components/check-field";
import { DatePicker } from "@/components/date-picker";
import { cn } from "@/lib/utils";
import { EVENT_COLOR_LABELS, eventTone } from "./event-tone";

export type EventDialogState = { mode: "new"; date: string; startTime?: string } | { mode: "edit"; occurrence: HrOccurrence; series: HrSeries };

const REPEAT_OPTIONS = [
  { value: "none", label: "Does not repeat" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
];

/** "09:00" → "10:00", never past "23:59". */
const hourLater = (hhmm: string) => {
  const h = Number(hhmm.slice(0, 2)) + 1;
  return h > 23 ? "23:59" : `${String(h).padStart(2, "0")}${hhmm.slice(2)}`;
};

/** Add an HR event, or edit / delete one — a repeating one for this occurrence only or the whole series. */
export function HrEventDialog({ state, onOpenChange }: { state: EventDialogState | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={state !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">{state && <EventForm key={state.mode === "edit" ? state.occurrence.key : `${state.date}:${state.startTime ?? ""}`} state={state} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function EventForm({ state, onDone }: { state: EventDialogState; onDone: () => void }) {
  const router = useRouter();
  const editing = state.mode === "edit" ? state : null;
  const repeating = Boolean(editing && editing.series.recurrence !== "none");
  const [scope, setScope] = useState<"occurrence" | "series">("occurrence");
  const [deleting, setDeleting] = useState(false);
  const o = editing?.occurrence;
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<HrEventInput>({
    resolver: zodResolver(hrEventSchema),
    defaultValues: o
      ? {
          title: o.title,
          notes: o.notes ?? "",
          color: o.color,
          startDate: o.startDate,
          endDate: o.endDate,
          allDay: o.allDay,
          startTime: o.startTime ?? undefined,
          endTime: o.endTime ?? undefined,
          recurrence: editing!.series.recurrence,
          repeatUntil: editing!.series.repeatUntil ?? "",
        }
      : {
          title: "",
          notes: "",
          color: "blue",
          startDate: state.mode === "new" ? state.date : "",
          endDate: state.mode === "new" ? state.date : "",
          // From an hour on the week grid: a one-hour timed event.
          ...(state.mode === "new" && state.startTime ? { allDay: false, startTime: state.startTime, endTime: hourLater(state.startTime) } : { allDay: true }),
          recurrence: "none",
          repeatUntil: "",
        },
  });
  const allDay = useWatch({ control, name: "allDay" });
  const recurrence = useWatch({ control, name: "recurrence" });
  const seriesFields = !repeating || scope === "series";
  const target = editing ? { id: editing.occurrence.eventId, scope: repeating ? scope : "series", occurrenceDate: editing.occurrence.occurrenceDate } : null;

  const onSubmit = handleSubmit(async (values) => {
    const res = target ? await updateHrEvent(target, values) : await createHrEvent(values);
    if (!res.ok) return void toast.error(res.error);
    toast.success(target ? "Event saved" : "Event added");
    onDone();
    router.refresh();
  });

  const onDelete = async () => {
    if (!target) return;
    setDeleting(true);
    const res = await deleteHrEvent(target);
    setDeleting(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(target.scope === "occurrence" ? "This occurrence was removed" : "Event deleted");
    onDone();
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit event" : "New event"}</DialogTitle>
        <DialogDescription>{editing && repeating ? "Part of a repeating series." : "On HR's calendar — only HR sees it."}</DialogDescription>
      </DialogHeader>

      <FormField label="Title" htmlFor="ev-title" required error={errors.title?.message}>
        <Input {...fieldA11y("ev-title", errors.title?.message)} placeholder="Monthly report deadline" {...register("title")} />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Starts" htmlFor="ev-start" required error={errors.startDate?.message}>
          <Controller control={control} name="startDate" render={({ field }) => <DatePicker id="ev-start" value={field.value} onChange={field.onChange} />} />
        </FormField>
        <FormField label="Ends" htmlFor="ev-end" required error={errors.endDate?.message}>
          <Controller control={control} name="endDate" render={({ field }) => <DatePicker id="ev-end" value={field.value} onChange={field.onChange} />} />
        </FormField>
      </div>

      <Controller control={control} name="allDay" render={({ field }) => <CheckField id="ev-allday" checked={field.value ?? true} onChange={field.onChange} label="All day" />} />
      {!allDay && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="From" htmlFor="ev-from" required error={errors.startTime?.message}>
            <Input type="time" {...fieldA11y("ev-from", errors.startTime?.message)} {...register("startTime")} />
          </FormField>
          <FormField label="To" htmlFor="ev-to" required error={errors.endTime?.message}>
            <Input type="time" {...fieldA11y("ev-to", errors.endTime?.message)} {...register("endTime")} />
          </FormField>
        </div>
      )}

      {seriesFields && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Repeat" htmlFor="ev-repeat">
            <Controller control={control} name="recurrence" render={({ field }) => <SelectField id="ev-repeat" value={field.value} onChange={field.onChange} options={REPEAT_OPTIONS} />} />
          </FormField>
          {recurrence !== "none" && (
            <FormField label="Until" htmlFor="ev-until" hint="Leave empty to keep repeating" error={errors.repeatUntil?.message}>
              <Controller control={control} name="repeatUntil" render={({ field }) => <DatePicker id="ev-until" value={field.value} onChange={field.onChange} clearable placeholder="No end date" />} />
            </FormField>
          )}
        </div>
      )}

      <FormField label="Colour" htmlFor="ev-color-blue">
        <Controller
          control={control}
          name="color"
          render={({ field }) => (
            <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2">
              {HR_EVENT_COLORS.map((c: HrEventColor) => {
                const tone = eventTone(c);
                return (
                  <button
                    key={c}
                    id={`ev-color-${c}`}
                    type="button"
                    role="radio"
                    aria-checked={field.value === c}
                    aria-label={EVENT_COLOR_LABELS[c]}
                    title={EVENT_COLOR_LABELS[c]}
                    onClick={() => field.onChange(c)}
                    className={cn(
                      "grid size-7 place-items-center rounded-full border outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]",
                      field.value === c && "ring-foreground ring-2 ring-offset-2 ring-offset-[var(--background)]",
                    )}
                    style={tone.fill}
                  >
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: tone.dot }} />
                  </button>
                );
              })}
            </div>
          )}
        />
      </FormField>

      <FormField label="Notes" htmlFor="ev-notes" error={errors.notes?.message}>
        <Textarea rows={2} {...fieldA11y("ev-notes", errors.notes?.message)} {...register("notes")} />
      </FormField>

      {repeating && (
        <FormField label="Apply to" htmlFor="ev-scope">
          <SelectField
            id="ev-scope"
            value={scope}
            onChange={(v) => setScope(v as "occurrence" | "series")}
            options={[
              { value: "occurrence", label: "This event only" },
              { value: "series", label: "All events in the series" },
            ]}
          />
        </FormField>
      )}

      <DialogFooter className="sm:justify-between">
        {editing ? (
          <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" disabled={deleting || isSubmitting} onClick={onDelete}>
            {deleting ? "Deleting…" : repeating && scope === "occurrence" ? "Delete this event" : "Delete"}
          </Button>
        ) : (
          <span />
        )}
        <span className="flex gap-2">
          <Button type="button" variant="tertiary" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting || deleting}>
            {isSubmitting ? "Saving…" : editing ? "Save" : "Add event"}
          </Button>
        </span>
      </DialogFooter>
    </form>
  );
}
