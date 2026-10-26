"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { TaskDetail } from "@/lib/tasks/queries";
import type { TaskPatch } from "@/lib/validation";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/validation";
import { formatDate, formatDateTime, formatHours, sentenceEnum } from "@/lib/format";
import {
  addComment,
  decideDueChange,
  deleteComment,
  deleteTask,
  editComment,
  loadTask,
  reviewTask,
  updateDescription,
  updateTask,
} from "@/app/(app)/tasks/actions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/form-field";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { RowActions } from "@/components/row-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SelectField } from "@/components/select-field";
import { DatePicker } from "@/components/date-picker";
import { AmountInput } from "@/components/amount-input";
import { PeoplePicker } from "@/components/people-picker";
import { StatusBadge, statusLabel } from "@/components/status-badge";
import { Icon } from "@/components/icon";
import { LogTimeButton } from "@/components/time/log-time-dialog";
import { cn } from "@/lib/utils";
import { TaskTitle } from "./task-title";
import { TaskEditor, type SaveState } from "./task-editor";
import { TaskTimeline } from "./task-timeline";
import { usePanelWidth } from "./use-panel-width";

const SAVE_LABEL: Record<SaveState, string> = { idle: "", saving: "Saving…", saved: "Saved", error: "Couldn't save" };

export const taskKey = (id: string | null) => ["task", id] as const;

/**
 * The task detail panel (M2.5–M2.7). Opens on `?task=<id>` from the project
 * views and My Tasks. Fields save as they change.
 */
export function TaskPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const taskId = params.get("task");
  const { width, dragging, expanded, toggleExpanded, handleProps } = usePanelWidth();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const close = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete("task");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const { data, isLoading, isError } = useQuery<TaskDetail>({
    queryKey: taskKey(taskId),
    queryFn: () => loadTask(taskId),
    enabled: Boolean(taskId),
    staleTime: 0,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: taskKey(taskId) });
    router.refresh();
  };

  const patch = async (p: TaskPatch) => {
    if (!data) return false;
    const res = await updateTask(data.id, p);
    if (!res.ok) toast.error(res.error);
    else if (res.data.dueRequested) toast.success("Due date change sent to the PM for approval");
    refresh();
    return res.ok;
  };
  const [dueAsk, setDueAsk] = useState<string | null>(null);

  const canEdit = data?.viewer.canEdit ?? false;

  return (
    <Sheet open={Boolean(taskId)} onOpenChange={(open) => !open && close()}>
      <SheetContent
        showCloseButton={false}
        style={{ "--task-panel-w": `${width}px` } as React.CSSProperties}
        className={cn(
          "flex w-full flex-col gap-0 overflow-y-auto p-0 data-[side=right]:sm:w-(--task-panel-w) data-[side=right]:sm:max-w-none",
          // Keep the sheet's slide-in (translate, opacity) when adding the resize easing.
          !dragging && "motion-safe:transition-[translate,opacity,width]",
          dragging && "select-none",
        )}
      >
        <div {...handleProps} className="group absolute inset-y-0 left-0 z-10 hidden w-1.5 cursor-col-resize touch-none focus-visible:outline-none sm:block">
          <span className={cn("bg-divider absolute inset-y-0 left-0 w-px opacity-0 transition-opacity group-hover:opacity-100", dragging && "bg-foreground/40 opacity-100")} />
        </div>
        <SheetHeader className="sr-only">
          <SheetTitle>Task detail</SheetTitle>
        </SheetHeader>

        {isLoading && (
          <div className="flex flex-col gap-4 p-6">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
        {isError && (
          <div className="p-6">
            <ErrorState title="Couldn't load this task" description="It may have been deleted, or you're not on its project." />
          </div>
        )}

        {data && (
          <>
            <div className="flex items-center justify-between gap-2 border-b px-6 py-3">
              <Link href={`/projects/${data.project.id}`} className="text-muted-foreground hover:text-foreground truncate text-caption">
                {data.project.code} · {data.project.name}
                <span className="ml-2">{SAVE_LABEL[saveState]}</span>
              </Link>
              <div className="flex items-center gap-1">
                {data.viewer.canLogTime && <LogTimeButton taskId={data.id} variant="ghost" />}
                <Button type="button" variant="ghost" size="icon-sm" aria-label={expanded ? "Collapse" : "Expand"} onClick={toggleExpanded}>
                  <Icon name="expand" size={15} />
                </Button>
                <RowActions
                  label="More actions"
                  actions={[
                    {
                      label: "Copy task link",
                      icon: "link",
                      onSelect: () => {
                        void navigator.clipboard.writeText(`${window.location.origin}/projects/${data.project.id}?task=${data.id}`);
                        toast.success("Link copied");
                      },
                    },
                    { label: "Delete task", icon: "delete", destructive: true, hidden: !data.viewer.canDelete, onSelect: () => setConfirmDelete(true) },
                  ]}
                />
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" onClick={close}>
                  <Icon name="close" size={16} />
                </Button>
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
              <div className="flex flex-col gap-2">
                <TaskTitle title={data.title} editable={canEdit} onSave={(title) => void patch({ title })} />
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge value={data.status} />
                  {data.overdue && <StatusBadge value="overdue" label="Overdue" />}
                  {data.type && <StatusBadge value="neutral" label={data.type.name} />}
                  {data.missing.length > 0 && <StatusBadge value="warning" label={`Missing ${data.missing.join(", ")}`} />}
                  {data.hasTime && <span className="text-muted-foreground tabular text-caption">{formatHours(data.loggedMinutes)} logged</span>}
                </div>
              </div>

              {data.viewer.canReview && <ReviewBox taskId={data.id} onDone={refresh} />}

              <dl className="grid grid-cols-[96px_1fr] items-center gap-x-3 gap-y-2 text-body">
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <SelectField
                    aria-label="Status"
                    size="compact"
                    className="max-w-52"
                    disabled={!canEdit}
                    value={data.status}
                    onChange={(v) => void patch({ status: v as TaskDetail["status"] })}
                    options={TASK_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
                  />
                </dd>
                <dt className="text-muted-foreground">Type</dt>
                <dd>
                  <SelectField
                    aria-label="Type"
                    size="compact"
                    className="max-w-52"
                    disabled={!canEdit}
                    value={data.type?.id ?? ""}
                    onChange={(v) => v && void patch({ typeId: v })}
                    options={data.types.map((t) => ({ value: t.id, label: t.name }))}
                  />
                </dd>
                <dt className="text-muted-foreground">Reviewer</dt>
                <dd>
                  <SelectField
                    aria-label="Reviewer"
                    size="compact"
                    className="max-w-52"
                    disabled={!canEdit && !data.viewer.canManage}
                    value={data.reviewer?.id ?? ""}
                    noneLabel="No reviewer"
                    onChange={(v) => void patch({ reviewerId: v || null })}
                    options={data.reviewers.map((m) => ({ value: m.id, label: m.name }))}
                  />
                </dd>
                <dt className="text-muted-foreground">Owner</dt>
                <dd>
                  <SelectField
                    aria-label="Owner"
                    size="compact"
                    className="max-w-52"
                    disabled={!canEdit}
                    value={data.owner?.id ?? ""}
                    noneLabel="No owner"
                    onChange={(v) => void patch({ ownerId: v || null })}
                    options={data.members.map((m) => ({ value: m.id, label: m.name }))}
                  />
                </dd>
                <dt className="text-muted-foreground">Collaborators</dt>
                <dd>
                  <PeoplePicker
                    aria-label="Collaborators"
                    disabled={!canEdit}
                    people={data.members.filter((m) => m.id !== data.owner?.id)}
                    value={data.collaborators.map((c) => c.id)}
                    onChange={(ids) => void patch({ collaboratorIds: ids })}
                    placeholder="Add collaborators"
                    className="max-w-sm"
                  />
                </dd>
                <dt className="text-muted-foreground">Priority</dt>
                <dd>
                  <SelectField
                    aria-label="Priority"
                    size="compact"
                    className="max-w-52"
                    disabled={!canEdit}
                    value={data.priority}
                    onChange={(v) => void patch({ priority: v as TaskDetail["priority"] })}
                    options={TASK_PRIORITIES.map((p) => ({ value: p, label: sentenceEnum(p) }))}
                  />
                </dd>
                <dt className="text-muted-foreground">Section</dt>
                <dd>
                  <SelectField
                    aria-label="Section"
                    size="compact"
                    className="max-w-52"
                    disabled={!canEdit}
                    value={data.sectionId}
                    onChange={(v) => void patch({ sectionId: v })}
                    options={data.sections.map((s) => ({ value: s.id, label: s.name }))}
                  />
                </dd>
                <dt className="text-muted-foreground">Due date</dt>
                <dd>
                  <div className="flex flex-col gap-1">
                    <DatePicker
                      aria-label="Due date"
                      className="w-full max-w-52"
                      placeholder="No due date"
                      disabled={!canEdit}
                      clearable={!data.dueDate}
                      value={data.dueDate ?? ""}
                      // A due date that's set moves only with a reason (PRD Phase 2).
                      onChange={(v) => (data.dueDate && v ? setDueAsk(v) : void patch({ dueDate: v || null }))}
                    />
                    {data.effectiveDue && data.effectiveDue !== data.dueDate && (
                      <span className="text-muted-foreground text-caption">Effective due {formatDate(data.effectiveDue)} — review took longer than its SLA</span>
                    )}
                    {data.originalDueDate && data.originalDueDate !== data.dueDate && (
                      <span className="text-muted-foreground text-caption">First due {formatDate(data.originalDueDate)}</span>
                    )}
                  </div>
                </dd>
                <dt className="text-muted-foreground">Estimate</dt>
                <dd>
                  <EstimateField value={data.estimateHours} disabled={!canEdit} onSave={(h) => void patch({ estimateHours: h })} />
                </dd>
                <dt className="text-muted-foreground">Deliverable</dt>
                <dd>
                  <DeliverableField key={data.id} value={data.deliverableUrl} disabled={!canEdit} onSave={(url) => void patch({ deliverableUrl: url })} />
                </dd>
              </dl>

              {data.dueChanges.some((c) => c.state === "pending") && (
                <DueRequests changes={data.dueChanges.filter((c) => c.state === "pending")} canDecide={data.viewer.canManage} onDone={refresh} />
              )}

              <p className="text-muted-foreground text-caption">
                Created {formatDate(data.createdAt)}
                {data.approvedAt && ` · Approved ${formatDate(data.approvedAt)}`}
              </p>

              {data.reviewRounds.length > 0 && <ReviewHistory rounds={data.reviewRounds} />}

              <section className="border-divider border-t pt-5">
                <h3 className="text-muted-foreground mb-2 text-caption font-medium tracking-wide uppercase">Description</h3>
                <TaskEditor
                  key={data.id}
                  taskId={data.id}
                  content={data.description}
                  editable={canEdit}
                  onSave={async (content) => {
                    const res = await updateDescription(data.id, content);
                    if (!res.ok) toast.error(res.error);
                    return res.ok;
                  }}
                  onSaveStateChange={setSaveState}
                />
              </section>

              <section className="border-divider border-t pt-5">
                <h3 className="text-muted-foreground mb-3 text-caption font-medium tracking-wide uppercase">Comments & activity</h3>
                <TaskTimeline
                  comments={data.comments}
                  activity={data.activity}
                  people={data.members}
                  canComment={data.viewer.canComment}
                  onAdd={async (text) => {
                    const res = await addComment(data.id, { text });
                    if (!res.ok) toast.error(res.error);
                    else refresh();
                    return res.ok;
                  }}
                  onEdit={async (id, text) => {
                    const res = await editComment(id, { text });
                    if (!res.ok) toast.error(res.error);
                    else refresh();
                    return res.ok;
                  }}
                  onDelete={async (id) => {
                    const res = await deleteComment(id);
                    if (!res.ok) toast.error(res.error);
                    else refresh();
                    return res.ok;
                  }}
                />
              </section>
            </div>
          </>
        )}
      </SheetContent>

      {data && dueAsk && (
        <DueReasonDialog
          from={data.dueDate}
          to={dueAsk}
          direct={data.viewer.canManage}
          onClose={() => setDueAsk(null)}
          onSubmit={async (reason) => {
            const ok = await patch({ dueDate: dueAsk, dueReason: reason });
            if (ok) setDueAsk(null);
          }}
        />
      )}
      {data && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete “${data.title}”?`}
          description="The task, its comments and history are removed. Tasks with logged time can't be deleted."
          confirmLabel="Delete task"
          destructive
          onConfirm={async () => {
            const res = await deleteTask(data.id);
            if (!res.ok) {
              toast.error(res.error);
              return false;
            }
            toast.success("Task deleted");
            close();
            router.refresh();
          }}
        />
      )}
    </Sheet>
  );
}

function EstimateField({ value, disabled, onSave }: { value: number | null; disabled: boolean; onSave: (hours: number | null) => void }) {
  const [draft, setDraft] = useState<number | null>(value);
  return (
    <div className="flex max-w-52 items-center gap-2">
      <AmountInput
        aria-label="Estimate in hours"
        value={draft}
        onChange={setDraft}
        disabled={disabled}
        placeholder="—"
        className="h-8"
        onBlur={() => draft !== value && onSave(draft)}
      />
      <span className="text-muted-foreground text-caption">hours</span>
    </div>
  );
}

function DeliverableField({ value, disabled, onSave }: { value: string | null; disabled: boolean; onSave: (url: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? "");
  return (
    <div className="flex max-w-sm items-center gap-2">
      <Input
        aria-label="Deliverable link"
        value={draft}
        disabled={disabled}
        placeholder="Figma or delivery link"
        className="h-8"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() !== (value ?? "") && onSave(draft.trim() || null)}
      />
      {value && (
        <a href={value} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Open deliverable">
          <Icon name="external" size={14} />
        </a>
      )}
    </div>
  );
}

/** The reviewer's decision: approve, or send back with what needs to change. */
function ReviewBox({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const decide = async (decision: "approve" | "changes") => {
    setBusy(true);
    const res = await reviewTask(taskId, { decision, note });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(decision === "approve" ? "Approved" : "Sent back with your notes");
    setNote("");
    onDone();
  };
  return (
    <section aria-label="Review" className="flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-body font-medium">Waiting for your review</p>
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notes — required when you ask for changes" rows={2} aria-label="Review notes" />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="tertiary" size="sm" disabled={busy} onClick={() => void decide("changes")}>
          Request changes
        </Button>
        <Button type="button" size="sm" disabled={busy} onClick={() => void decide("approve")}>
          Approve
        </Button>
      </div>
    </section>
  );
}

type Round = TaskDetail["reviewRounds"][number];

function ReviewHistory({ rounds }: { rounds: Round[] }) {
  return (
    <section className="border-divider border-t pt-5">
      <h3 className="text-muted-foreground mb-2 text-caption font-medium tracking-wide uppercase">Review rounds</h3>
      <ul className="flex flex-col gap-2">
        {rounds.map((r) => {
          const late = (r.decidedAt ?? new Date()) > r.slaDueAt;
          return (
            <li key={r.id} className="flex flex-col gap-0.5 text-body">
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  value={r.decision === "approved" ? "approved" : r.decision === "changes_requested" ? "warning" : r.decidedAt ? "neutral" : "pending"}
                  label={r.decision === "approved" ? "Approved" : r.decision === "changes_requested" ? "Changes requested" : r.decidedAt ? "Withdrawn" : "Waiting"}
                />
                <span className="text-muted-foreground text-caption">
                  {r.reviewer} · sent {formatDateTime(r.submittedAt)}
                  {r.decidedAt && ` · decided ${formatDateTime(r.decidedAt)}`}
                </span>
                {late && <span className="text-warning text-caption">past SLA</span>}
              </span>
              {r.note && <span className="text-muted-foreground text-caption">{r.note}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type DueRequest = TaskDetail["dueChanges"][number];

function DueRequests({ changes, canDecide, onDone }: { changes: DueRequest[]; canDecide: boolean; onDone: () => void }) {
  const decide = async (id: string, approve: boolean) => {
    const res = await decideDueChange(id, { approve });
    if (!res.ok) return void toast.error(res.error);
    toast.success(approve ? "New due date approved" : "Request turned down");
    onDone();
  };
  return (
    <section aria-label="Due date requests" className="flex flex-col gap-2 rounded-lg border p-3">
      {changes.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-body">
            {c.requester} asks to move the due date to <span className="tabular">{formatDate(c.to)}</span>
            <span className="text-muted-foreground block text-caption">{c.reason}</span>
          </span>
          {canDecide ? (
            <span className="flex gap-2">
              <Button type="button" variant="tertiary" size="sm" onClick={() => void decide(c.id, false)}>
                Decline
              </Button>
              <Button type="button" size="sm" onClick={() => void decide(c.id, true)}>
                Approve
              </Button>
            </span>
          ) : (
            <StatusBadge value="pending" label="Waiting for the PM" />
          )}
        </div>
      ))}
    </section>
  );
}

function DueReasonDialog({
  from,
  to,
  direct,
  onClose,
  onSubmit,
}: {
  from: string | null;
  to: string;
  direct: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            await onSubmit(reason);
            setBusy(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>Move the due date</DialogTitle>
            <DialogDescription>
              {from ? `${formatDate(from)} → ${formatDate(to)}. ` : ""}
              {direct
                ? "As the project's PM your change applies right away. It counts for on-time only if made before the due date passes."
                : "The project's PM approves the change. It counts for on-time only if approved before the due date passes."}
            </DialogDescription>
          </DialogHeader>
          <FormField label="Reason" htmlFor="due-reason" required>
            <Textarea id="due-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !reason.trim()}>
              {direct ? "Move due date" : "Ask the PM"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
