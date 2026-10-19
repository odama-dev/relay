"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { TaskDetail } from "@/lib/tasks/queries";
import type { TaskPatch } from "@/lib/validation";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/validation";
import { formatDate, formatHours, sentenceEnum } from "@/lib/format";
import {
  addComment,
  deleteComment,
  deleteTask,
  editComment,
  loadTask,
  updateDescription,
  updateTask,
} from "@/app/(app)/tasks/actions";
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
import { StatusBadge } from "@/components/status-badge";
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
    if (!data) return;
    const res = await updateTask(data.id, p);
    if (!res.ok) toast.error(res.error);
    refresh();
  };

  const canEdit = data?.viewer.canEdit ?? false;

  return (
    <Sheet open={Boolean(taskId)} onOpenChange={(open) => !open && close()}>
      <SheetContent
        showCloseButton={false}
        style={{ "--task-panel-w": `${width}px` } as React.CSSProperties}
        className={cn(
          "flex w-full flex-col gap-0 overflow-y-auto p-0 data-[side=right]:sm:w-(--task-panel-w) data-[side=right]:sm:max-w-none",
          !dragging && "motion-safe:transition-[width]",
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
                  {data.hasTime && <span className="text-muted-foreground tabular text-caption">{formatHours(data.loggedMinutes)} logged</span>}
                </div>
              </div>

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
                    options={TASK_STATUSES.map((s) => ({ value: s, label: s === "todo" ? "To do" : sentenceEnum(s) }))}
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
                  <DatePicker
                    aria-label="Due date"
                    className="w-full max-w-52"
                    placeholder="No due date"
                    disabled={!canEdit}
                    clearable
                    value={data.dueDate ?? ""}
                    onChange={(v) => void patch({ dueDate: v || null })}
                  />
                </dd>
                <dt className="text-muted-foreground">Estimate</dt>
                <dd>
                  <EstimateField value={data.estimateHours} disabled={!canEdit} onSave={(h) => void patch({ estimateHours: h })} />
                </dd>
              </dl>

              <p className="text-muted-foreground text-caption">
                Created {formatDate(data.createdAt)}
                {data.completedAt && ` · Done ${formatDate(data.completedAt)}`}
              </p>

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
