"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import type { SectionRow, TaskPerson, TaskRow } from "@/lib/tasks/queries";
import { AmountInput } from "@/components/amount-input";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/validation";
import { formatDateShort, sentenceEnum } from "@/lib/format";
import { archiveSection, createSection, createTask, moveSection, renameSection } from "@/app/(app)/tasks/actions";
import { ViewToggle, LIST_KANBAN_OPTIONS, type ViewMode } from "@/components/view-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { DatePicker } from "@/components/date-picker";
import { PeoplePicker } from "@/components/people-picker";
import { RowActions } from "@/components/row-actions";
import { EmptyState } from "@/components/states";
import { Icon, icons } from "@/components/icon";
import { cn } from "@/lib/utils";
import { TaskList } from "./task-list";
import { TaskKanban, STATUS_LABEL } from "./task-kanban";

const ALL = "";

type TaskTypeOption = { id: string; name: string; key: string };
type LeaveRange = { userId: string; start: string; end: string };

/**
 * A project's tasks (M2.1–M2.3): list grouped by section or kanban by status,
 * filtered by owner, priority, section or "my tasks". Filters and view live
 * in the URL so links keep them.
 */
export function ProjectTaskBoard({
  projectId,
  sections,
  tasks,
  types,
  reviewers,
  leave = [],
  members,
  viewerId,
  canManage,
  canCreate,
}: {
  projectId: string;
  sections: SectionRow[];
  tasks: TaskRow[];
  types: TaskTypeOption[];
  reviewers: TaskPerson[];
  leave?: LeaveRange[];
  members: TaskPerson[];
  viewerId: string;
  canManage: boolean;
  canCreate: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = (params.get("view") === "list" ? "list" : "kanban") as ViewMode;
  const owner = params.get("owner") ?? ALL;
  const priority = params.get("priority") ?? ALL;
  const section = params.get("section") ?? ALL;
  const mine = params.get("mine") === "1";
  const openTaskId = params.get("task");
  const [newTask, setNewTask] = useState<{ sectionId?: string; status?: TaskRow["status"] } | null>(null);
  const [addingSection, setAddingSection] = useState(false);

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const open = (id: string) => setParam({ task: id });

  const filtered = tasks.filter(
    (t) =>
      (!owner || (owner === "none" ? !t.owner : t.owner?.id === owner)) &&
      (!priority || t.priority === priority) &&
      (!section || t.sectionId === section) &&
      (!mine || t.mine),
  );
  const visibleSections = section ? sections.filter((s) => s.id === section) : sections;
  const canEdit = (t: TaskRow) => canManage || t.mine;
  const filtering = Boolean(owner || priority || section || mine);

  const sectionHeader = (s: SectionRow, count: number) => (
    <div className="flex items-center gap-2 px-2">
      <h3 className="text-body font-medium">{s.name}</h3>
      <span className="text-muted-foreground tabular text-caption">{count}</span>
      <span className="flex-1" />
      {canCreate && (
        <Button variant="ghost" size="icon-sm" aria-label={`Add task to ${s.name}`} onClick={() => setNewTask({ sectionId: s.id })}>
          <Icon name="add" size={14} />
        </Button>
      )}
      {canManage && (
        <RowActions
          label={`Actions for section ${s.name}`}
          actions={[
            {
              label: "Rename",
              icon: "edit",
              onSelect: async () => {
                const name = window.prompt("Section name", s.name)?.trim();
                if (!name || name === s.name) return;
                const res = await renameSection(s.id, { name });
                if (!res.ok) toast.error(res.error);
                else router.refresh();
              },
            },
            { label: "Move up", icon: "arrowUp", hidden: sections[0]?.id === s.id, onSelect: async () => done(await moveSection(s.id, "up")) },
            { label: "Move down", icon: "arrowDown", hidden: sections.at(-1)?.id === s.id, onSelect: async () => done(await moveSection(s.id, "down")) },
            { label: "Archive section", icon: "archive", destructive: true, hidden: sections.length <= 1, onSelect: async () => done(await archiveSection(s.id), "Section archived — its tasks are hidden, logged time still counts") },
          ]}
        />
      )}
    </div>
  );

  const done = (res: { ok: boolean; error?: string }, message?: string) => {
    if (!res.ok) return void toast.error(res.error);
    if (message) toast.success(message);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <ViewToggle value={view} onChange={(v) => setParam({ view: v === "kanban" ? null : v })} options={LIST_KANBAN_OPTIONS} />
        <SelectField
          aria-label="Owner"
          size="compact"
          className="w-36"
          value={owner}
          noneLabel="All owners"
          onChange={(v) => setParam({ owner: v || null })}
          options={[{ value: "none", label: "No owner" }, ...members.map((m) => ({ value: m.id, label: m.name }))]}
        />
        <SelectField
          aria-label="Priority"
          size="compact"
          className="w-32"
          value={priority}
          noneLabel="All priorities"
          onChange={(v) => setParam({ priority: v || null })}
          options={TASK_PRIORITIES.map((p) => ({ value: p, label: sentenceEnum(p) }))}
        />
        {sections.length > 1 && (
          <SelectField
            aria-label="Section"
            size="compact"
            className="w-36"
            value={section}
            noneLabel="All sections"
            onChange={(v) => setParam({ section: v || null })}
            options={sections.map((s) => ({ value: s.id, label: s.name }))}
          />
        )}
        <Button variant={mine ? "secondary" : "ghost"} size="sm" aria-pressed={mine} onClick={() => setParam({ mine: mine ? null : "1" })}>
          My tasks
        </Button>
        {filtering && (
          <Button variant="ghost" size="sm" onClick={() => setParam({ owner: null, priority: null, section: null, mine: null })}>
            Clear
          </Button>
        )}
        <span className="flex-1" />
        {canManage && (
          <Button variant="ghost" size="sm" onClick={() => setAddingSection(true)} leadingIcon={icons.add}>
            Section
          </Button>
        )}
        {canCreate && (
          <Button size="sm" onClick={() => setNewTask({})} leadingIcon={icons.add}>
            New task
          </Button>
        )}
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon="myTasks"
          title="No tasks yet"
          description={canCreate ? "Break the work into tasks with an owner, priority and due date." : "Tasks of this project appear here."}
          action={canCreate ? <Button onClick={() => setNewTask({})}>New task</Button> : null}
        />
      ) : view === "kanban" ? (
        <TaskKanban tasks={filtered} canEdit={canEdit} openTaskId={openTaskId} onOpen={open} />
      ) : (
        <TaskList
          sections={visibleSections}
          tasks={filtered}
          canEdit={canEdit}
          openTaskId={openTaskId}
          onOpen={open}
          renderSectionHeader={sectionHeader}
          renderSectionFooter={canCreate ? (s) => <QuickAdd projectId={projectId} sectionId={s.id} /> : undefined}
        />
      )}

      {newTask && (
        <NewTaskDialog
          projectId={projectId}
          sections={sections}
          members={members}
          types={types}
          reviewers={reviewers}
          leave={leave}
          viewerId={viewerId}
          initial={newTask}
          onClose={() => setNewTask(null)}
          onCreated={(id) => {
            setNewTask(null);
            router.refresh();
            open(id);
          }}
        />
      )}
      <Dialog open={addingSection} onOpenChange={setAddingSection}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const name = String(new FormData(e.currentTarget).get("name") ?? "");
              const res = await createSection(projectId, { name });
              if (!res.ok) return void toast.error(res.error);
              setAddingSection(false);
              router.refresh();
            }}
          >
            <DialogHeader>
              <DialogTitle>New section</DialogTitle>
            </DialogHeader>
            <FormField label="Name" htmlFor="sec-name" required>
              <Input id="sec-name" name="name" placeholder="Discovery, Design, Development…" autoFocus />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="tertiary" onClick={() => setAddingSection(false)}>
                Cancel
              </Button>
              <Button type="submit">Add section</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Inline "add a task" at the end of a section: type a title, Enter. */
function QuickAdd({ projectId, sectionId }: { projectId: string; sectionId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex items-center gap-2 px-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        setBusy(true);
        const res = await createTask(projectId, { title, sectionId });
        setBusy(false);
        if (!res.ok) return void toast.error(res.error);
        setTitle("");
        router.refresh();
      }}
    >
      <Icon name="add" size={12} className="text-muted-foreground ml-1" />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={busy}
        placeholder="Add task"
        aria-label="Add task"
        className="placeholder:text-muted-foreground h-8 flex-1 bg-transparent text-body outline-none"
      />
    </form>
  );
}

function NewTaskDialog({
  projectId,
  sections,
  members,
  types,
  reviewers,
  leave,
  viewerId,
  initial,
  onClose,
  onCreated,
}: {
  projectId: string;
  sections: SectionRow[];
  members: TaskPerson[];
  types: TaskTypeOption[];
  reviewers: TaskPerson[];
  leave: LeaveRange[];
  viewerId: string;
  initial: { sectionId?: string; status?: TaskRow["status"] };
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [sectionId, setSectionId] = useState(initial.sectionId ?? sections[0]?.id ?? "");
  const [ownerId, setOwnerId] = useState(members.some((m) => m.id === viewerId) ? viewerId : "");
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>([]);
  const [priority, setPriority] = useState<string>("normal");
  const [status, setStatus] = useState<string>(initial.status ?? "todo");
  const [dueDate, setDueDate] = useState("");
  const [typeId, setTypeId] = useState(types.find((t) => t.key === "regular")?.id ?? types[0]?.id ?? "");
  const [reviewerId, setReviewerId] = useState("");
  const [estimateHours, setEstimateHours] = useState<number | null>(null);
  const [deliverableUrl, setDeliverableUrl] = useState("");
  const [busy, setBusy] = useState(false);
  // PRD Phase 2: every task has a due date, a reviewer and an estimate of at least an hour.
  const complete = Boolean(title.trim() && dueDate && reviewerId && estimateHours !== null && estimateHours >= 1);
  const onLeave = ownerId && dueDate ? leave.find((l) => l.userId === ownerId && l.start <= dueDate && l.end >= dueDate) : undefined;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const res = await createTask(projectId, { title, sectionId, ownerId, collaboratorIds, priority, status, dueDate, typeId, reviewerId, estimateHours, deliverableUrl });
            setBusy(false);
            if (!res.ok) return void toast.error(res.error);
            onCreated(res.data.id);
          }}
        >
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
          </DialogHeader>
          <FormField label="Title" htmlFor="nt-title" required>
            <Input id="nt-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Section" htmlFor="nt-section" required>
              <SelectField id="nt-section" value={sectionId} onChange={setSectionId} options={sections.map((s) => ({ value: s.id, label: s.name }))} />
            </FormField>
            <FormField label="Owner" htmlFor="nt-owner">
              <SelectField id="nt-owner" value={ownerId} onChange={setOwnerId} noneLabel="No owner" options={members.map((m) => ({ value: m.id, label: m.name }))} />
            </FormField>
            <FormField label="Priority" htmlFor="nt-priority">
              <SelectField id="nt-priority" value={priority} onChange={setPriority} options={TASK_PRIORITIES.map((p) => ({ value: p, label: sentenceEnum(p) }))} />
            </FormField>
            <FormField label="Status" htmlFor="nt-status">
              <SelectField
                id="nt-status"
                value={status}
                onChange={setStatus}
                // Approval belongs to the reviewer.
                options={TASK_STATUSES.filter((s) => s !== "done").map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
              />
            </FormField>
            <FormField label="Type" htmlFor="nt-type" required>
              <SelectField id="nt-type" value={typeId} onChange={setTypeId} options={types.map((t) => ({ value: t.id, label: t.name }))} />
            </FormField>
            <FormField label="Reviewer" htmlFor="nt-reviewer" required>
              <SelectField id="nt-reviewer" value={reviewerId} onChange={setReviewerId} placeholder="Who approves it" options={reviewers.map((m) => ({ value: m.id, label: m.name }))} />
            </FormField>
            <FormField label="Due date" htmlFor="nt-due" required>
              <DatePicker id="nt-due" value={dueDate} onChange={setDueDate} placeholder="Pick a date" className="w-full" />
            </FormField>
            <FormField label="Estimate (hours)" htmlFor="nt-estimate" required hint="At least 1 hour — fold smaller work into a checklist.">
              <AmountInput id="nt-estimate" value={estimateHours} onChange={setEstimateHours} placeholder="e.g. 4" />
            </FormField>
          </div>
          {onLeave && (
            <p className="text-warning text-caption" role="status">
              {members.find((m) => m.id === ownerId)?.name ?? "The owner"} is on leave {onLeave.start === onLeave.end ? `on ${formatDateShort(onLeave.start)}` : `${formatDateShort(onLeave.start)} – ${formatDateShort(onLeave.end)}`}. Pick another owner or due date.
            </p>
          )}
          <FormField label="Deliverable link" htmlFor="nt-link" hint="Required for a shot: its Figma link.">
            <Input id="nt-link" value={deliverableUrl} onChange={(e) => setDeliverableUrl(e.target.value)} placeholder="https://" />
          </FormField>
          <FormField label="Collaborators">
            <PeoplePicker people={members.filter((m) => m.id !== ownerId)} value={collaboratorIds} onChange={setCollaboratorIds} className={cn("border")} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !complete}>
              {busy ? "Creating…" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
