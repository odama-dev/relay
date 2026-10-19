"use client";

import type { CSSProperties, Ref } from "react";
import type { TaskRow } from "@/lib/tasks/queries";
import { formatDateShort } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { MemberAvatar } from "@/components/member-avatar";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

/** One task line in the list view: title, owner, priority, status, due date (M2.3). */
export function TaskLine({
  task,
  onOpen,
  selected,
  showProject,
  dragHandleProps,
  innerRef,
  style,
  isDragging,
  trailing,
}: {
  task: TaskRow;
  onOpen: () => void;
  selected?: boolean;
  /** My Tasks: show the project code instead of nothing. */
  showProject?: boolean;
  dragHandleProps?: Record<string, unknown>;
  innerRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  isDragging?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <div
      ref={innerRef}
      style={style}
      data-selected={selected || undefined}
      className={cn(
        "group flex min-h-[36px] items-center gap-2 rounded-lg px-2 text-body transition-colors",
        "hover:bg-hover",
        selected && "bg-accent",
        isDragging && "opacity-40",
      )}
    >
      <span
        {...dragHandleProps}
        aria-hidden={!dragHandleProps}
        className={cn(
          "text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100",
          dragHandleProps ? "cursor-grab active:cursor-grabbing" : "invisible",
        )}
      >
        <Icon name="grip" size={12} />
      </span>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left focus-visible:outline-none">
        <span className={cn("min-w-0 truncate", task.status === "done" && "text-muted-foreground line-through")}>{task.title}</span>
        {showProject && <span className="text-muted-foreground shrink-0 text-caption">{task.projectCode}</span>}
      </button>
      <span className="hidden w-28 shrink-0 items-center gap-1.5 truncate sm:flex">
        {task.owner ? (
          <>
            <MemberAvatar seed={task.owner.id} src={task.owner.avatarUrl} size={18} />
            <span className="text-muted-foreground truncate text-caption">{task.owner.name}</span>
          </>
        ) : (
          <span className="text-muted-foreground text-caption">No owner</span>
        )}
      </span>
      <span className="hidden w-20 shrink-0 md:block">
        {task.priority !== "normal" && <StatusBadge value={task.priority} />}
      </span>
      <span className="w-24 shrink-0">
        <StatusBadge value={task.status} />
      </span>
      <span className={cn("tabular w-16 shrink-0 text-right text-caption", task.overdue ? "text-destructive" : "text-muted-foreground")}>
        {task.dueDate ? formatDateShort(task.dueDate) : "—"}
      </span>
      {trailing}
    </div>
  );
}

/** Kanban card body. */
export function TaskCardBody({
  task,
  onOpen,
  selected,
}: {
  task: TaskRow;
  onOpen: () => void;
  selected?: boolean;
}) {
  // Kanban card: the task, its priority, who it's assigned to and when it's due.
  return (
    <div className="flex flex-col gap-2.5" onClick={onOpen} data-selected={selected || undefined}>
      <div className="flex items-start gap-2 pr-6">
        <Icon name="file" size={16} className="text-muted-foreground mt-0.5" />
        <p className={cn("line-clamp-3 text-body font-semibold", task.status === "done" && "text-muted-foreground line-through")}>
          {task.title}
        </p>
      </div>
      <div className="flex">
        <StatusBadge value={task.priority} />
      </div>
      <div className="flex min-w-0 items-center gap-2 text-body">
        {task.owner ? (
          <>
            <MemberAvatar seed={task.owner.id} src={task.owner.avatarUrl} size={20} />
            <span className="truncate">{task.owner.name}</span>
          </>
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        )}
        {task.dueDate && (
          <span
            className={cn(
              "tabular ml-auto flex shrink-0 items-center gap-1 text-2xs",
              task.overdue ? "text-destructive" : "text-muted-foreground",
            )}
          >
            <Icon name="calendar" size={12} />
            {formatDateShort(task.dueDate)}
          </span>
        )}
      </div>
    </div>
  );
}
