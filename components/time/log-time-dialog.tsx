"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { LogTimeOptions, TaskOption } from "@/lib/time/queries";
import { parseDuration, weekStart } from "@/lib/time/pure";
import { formatDuration } from "@/lib/format";
import { getLogTimeOptions, logTime, requestCorrection, updateEntry } from "@/app/(app)/timesheet/actions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { FormField } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { CheckField } from "@/components/check-field";
import { DatePicker } from "@/components/date-picker";
import { Icon, icons } from "@/components/icon";
import { cn } from "@/lib/utils";

export const LOG_TIME_OPTIONS_KEY = ["log-time-options"] as const;

export type EntryDraft = {
  id?: string;
  entryDate?: string;
  minutes?: number;
  taskId?: string | null;
  categoryId?: string | null;
  note?: string | null;
  outOfScope?: boolean;
};

type Mode = "create" | "edit" | "correct" | "add-correction";

/**
 * Log time (M3.1), edit an entry (M3.4) or request a correction (M3.5) — one
 * form. Opened from the Timesheet, a task and My Tasks (task prefilled).
 */
export function LogTimeDialog({
  open,
  onOpenChange,
  mode = "create",
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: Mode;
  initial?: EntryDraft;
}) {
  const { data: options, isError } = useQuery({
    queryKey: LOG_TIME_OPTIONS_KEY,
    queryFn: () => getLogTimeOptions(),
    enabled: open,
    staleTime: 60_000,
  });

  const title = { create: "Log time", edit: "Edit entry", correct: "Request a correction", "add-correction": "Add forgotten time" }[mode];
  const description = {
    create: "Log to a task, or to a non-billable category.",
    edit: "Change this entry. Locked weeks need a correction instead.",
    correct: "This week is locked. Your project's PM (or HR, for categories) reviews the change.",
    "add-correction": "This week is locked. Ask for the missing time to be added.",
  }[mode];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {isError ? (
          <p className="text-destructive text-body">Couldn&apos;t load your tasks. Close and try again.</p>
        ) : !options ? (
          <div className="grid gap-3">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-20" />
          </div>
        ) : (
          <EntryForm options={options} mode={mode} initial={initial} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EntryForm({ options, mode, initial, onDone }: { options: LogTimeOptions; mode: Mode; initial?: EntryDraft; onDone: () => void }) {
  const router = useRouter();
  const correcting = mode === "correct" || mode === "add-correction";
  const locked = useMemo(() => new Set(options.lockedWeeks), [options.lockedWeeks]);
  const firstOpenDay = locked.has(weekStart(options.today)) ? "" : options.today;

  const [date, setDate] = useState(initial?.entryDate ?? (correcting ? "" : firstOpenDay));
  const [duration, setDuration] = useState(initial?.minutes ? formatDuration(initial.minutes) : "");
  const [target, setTarget] = useState<"task" | "category">(initial?.categoryId ? "category" : "task");
  const [taskId, setTaskId] = useState(initial?.taskId ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [oos, setOos] = useState(Boolean(initial?.outOfScope));
  const [reason, setReason] = useState("");
  const [removeEntry, setRemoveEntry] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefilled task that isn't in the list (e.g. Done) still shows by name.
  const task = options.tasks.find((t) => t.id === taskId);
  const minutes = parseDuration(duration);
  const canOos = target === "task" && Boolean(task?.clientProject);

  const submit = async () => {
    setError(null);
    if (!removeEntry) {
      if (!date) return setError("Pick a date.");
      if (!minutes) return setError("Enter a duration like 1h 30m, 1.5 or 90m.");
      if (target === "task" && !taskId) return setError("Choose a task.");
      if (target === "category" && !categoryId) return setError("Choose a category.");
      if (oos && canOos && !note.trim()) return setError("Describe what was asked outside the scope.");
    }
    if (correcting && reason.trim().length < 3) return setError("Explain the reason for the correction.");

    const values = {
      entryDate: date,
      minutes: minutes ?? 1,
      taskId: target === "task" ? taskId : "",
      categoryId: target === "category" ? categoryId : "",
      note,
      outOfScope: oos && canOos,
    };
    setSubmitting(true);
    const res =
      mode === "edit" && initial?.id
        ? await updateEntry(initial.id, values)
        : correcting
          ? await requestCorrection({ ...values, timeEntryId: initial?.id ?? "", reason, delete: removeEntry })
          : await logTime(values);
    setSubmitting(false);
    if (!res.ok) return setError(res.error);
    toast.success(correcting ? "Correction requested" : mode === "edit" ? "Entry updated" : `Logged ${formatDuration(values.minutes)}`);
    onDone();
    router.refresh();
  };

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {mode === "correct" && (
        <CheckField id="lt-remove" checked={removeEntry} onChange={setRemoveEntry} label="Remove this entry instead" />
      )}

      {!removeEntry && (
        <>
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <FormField label="Date" htmlFor="lt-date" required>
              <DatePicker
                id="lt-date"
                value={date}
                onChange={setDate}
                className="w-full"
                // Logging skips locked weeks; corrections are only for them.
                isDayDisabled={(d) => (correcting ? !locked.has(weekStart(d)) : locked.has(weekStart(d))) || d > options.today}
              />
            </FormField>
            <FormField label="Duration" htmlFor="lt-duration" required>
              <Input
                id="lt-duration"
                autoFocus
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="1h 30m"
                autoComplete="off"
                className="tabular"
              />
            </FormField>
          </div>

          <div className="bg-accent flex w-full gap-1 rounded-lg p-1" role="radiogroup" aria-label="Log to">
            {(["task", "category"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={target === t}
                onClick={() => setTarget(t)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1 text-body transition-colors",
                  target === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t === "task" ? "Task" : "Non-billable category"}
              </button>
            ))}
          </div>

          {target === "task" ? (
            <FormField label="Task" htmlFor="lt-task" required hint={options.tasks.length === 0 ? "You're not on any Active or On hold project." : undefined}>
              <TaskCombobox tasks={options.tasks} value={taskId} fallbackLabel={initial?.taskId && !task ? "Current task" : undefined} onChange={setTaskId} />
            </FormField>
          ) : (
            <FormField label="Category" htmlFor="lt-category" required>
              <SelectField
                id="lt-category"
                value={categoryId}
                onChange={setCategoryId}
                placeholder="Choose a category"
                options={options.categories.map((c) => ({ value: c.id, label: c.name }))}
              />
            </FormField>
          )}

          {canOos && (
            <CheckField
              id="lt-oos"
              checked={oos}
              onChange={setOos}
              label="Out of scope"
              hint="Work the client asked for outside the agreed scope. The PM reviews it before it's billed as a change request."
            />
          )}

          <FormField label={oos && canOos ? "What was asked outside the scope?" : "Note"} htmlFor="lt-note" required={oos && canOos}>
            <Textarea id="lt-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </>
      )}

      {correcting && (
        <FormField label="Reason" htmlFor="lt-reason" required>
          <Textarea id="lt-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Forgot to log Friday's client call" />
        </FormField>
      )}

      {error && (
        <p role="alert" className="text-destructive text-body">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="tertiary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : correcting ? "Request correction" : mode === "edit" ? "Save entry" : "Log time"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function TaskCombobox({
  tasks,
  value,
  fallbackLabel,
  onChange,
}: {
  tasks: TaskOption[];
  value: string;
  fallbackLabel?: string;
  onChange: (id: string) => void;
}) {
  // Recent tasks lead; every row reads "Task · CODE" and matches on the
  // project name too.
  const items = useMemo(
    () =>
      [...tasks.filter((t) => t.recent), ...tasks.filter((t) => !t.recent)].map((t) => ({
        value: t.id,
        label: `${t.title} · ${t.projectCode}`,
        search: `${t.projectCode} ${t.projectName} ${t.title}`.toLowerCase(),
        projectName: t.projectName,
        recent: t.recent,
      })),
    [tasks],
  );
  type Item = (typeof items)[number];

  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={(id) => id && onChange(id)}
      filter={(item, query) => (item as Item).search.includes(query.trim().toLowerCase())}
    >
      <ComboboxInput id="lt-task" placeholder={fallbackLabel ?? "Search task or project…"} className="w-full" />
      <ComboboxContent>
        <ComboboxEmpty>No task found.</ComboboxEmpty>
        <ComboboxList>
          {(item) => {
            const t = item as Item;
            return (
              <ComboboxItem value={t.value}>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate">{t.label}</span>
                  <span className="text-muted-foreground ml-auto shrink-0 truncate text-[length:var(--fs-caption,12px)]">
                    {t.recent ? "Recent" : t.projectName}
                  </span>
                </span>
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/** "Log time" button with its dialog, task optionally prefilled. */
export function LogTimeButton({
  taskId,
  variant = "tertiary",
  size = "compact",
  label = "Log time",
  className,
}: {
  taskId?: string;
  variant?: "tertiary" | "ghost" | "primary";
  size?: "compact" | "default" | "icon-compact";
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {size === "icon-compact" ? (
        <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)} className={className} aria-label={label}>
          <Icon name="time" />
        </Button>
      ) : (
        <Button type="button" variant={variant} size={size} leadingIcon={icons.time} onClick={() => setOpen(true)} className={className}>
          {label}
        </Button>
      )}
      {open && <LogTimeDialog open onOpenChange={setOpen} initial={{ taskId }} />}
    </>
  );
}
