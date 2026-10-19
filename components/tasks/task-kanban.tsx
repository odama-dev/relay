"use client";

import { useId } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TaskStatus } from "@prisma/client";
import type { TaskRow } from "@/lib/tasks/queries";
import { TASK_STATUSES } from "@/lib/validation";
import { KanbanColumn } from "@/components/kanban-column";
import { KanbanDragTilt, SORT_TRANSITION, kanbanCardClass, useKanbanDropAnimation } from "@/components/kanban-physics";
import { useKanbanDnd } from "@/components/use-kanban-dnd";
import { RowActions } from "@/components/row-actions";
import { moveTask } from "@/app/(app)/tasks/actions";
import { TaskCardBody } from "./task-row";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
};

type Item = TaskRow & { boardOrder: number };

/**
 * Kanban (M2.3): one column per status. Dragging a card to another column
 * changes its status; each card also has a "Move to" menu for keyboards.
 */
export function TaskKanban({
  tasks,
  canEdit,
  openTaskId,
  onOpen,
}: {
  tasks: TaskRow[];
  canEdit: (task: TaskRow) => boolean;
  openTaskId: string | null;
  onOpen: (id: string) => void;
}) {
  const dropAnimation = useKanbanDropAnimation();
  const dndId = useId();
  const items: Item[] = tasks.map((t) => ({ ...t, boardOrder: t.position }));
  const { cols, byId, handlers, activeItem, statusOf, moveTo } = useKanbanDnd<TaskStatus, Item>({
    items,
    statuses: TASK_STATUSES,
    canReorder: true,
    onMove: (id, status, n) => moveTask(id, { status, prevId: n.prevId, nextId: n.nextId }),
  });
  const targetStatus = activeItem ? statusOf(activeItem.id) : undefined;
  const overlay = activeItem ? byId.get(activeItem.id) : undefined;

  return (
    <DndContext id={dndId} {...handlers}>
      {/* Lanes run the board's height, like a pipeline view. */}
      <div className="-mx-1 flex min-h-[calc(100dvh-14rem)] gap-2 overflow-x-auto px-1 pb-2">
        {TASK_STATUSES.map((status) => (
          <KanbanColumn key={status} status={status} label={STATUS_LABEL[status]} itemIds={cols[status]} isTarget={targetStatus === status}>
            {cols[status].map((id) => {
              const task = byId.get(id);
              if (!task) return null;
              return (
                <Card
                  key={id}
                  task={{ ...task, status }}
                  editable={canEdit(task)}
                  selected={openTaskId === id}
                  onOpen={() => onOpen(id)}
                  onMove={(s) => moveTo(id, s)}
                />
              );
            })}
          </KanbanColumn>
        ))}
      </div>
      <DragOverlay dropAnimation={dropAnimation}>
        {overlay ? (
          <KanbanDragTilt>
            <div className={kanbanCardClass({})}>
              <TaskCardBody task={overlay} onOpen={() => {}} />
            </div>
          </KanbanDragTilt>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Card({
  task,
  editable,
  selected,
  onOpen,
  onMove,
}: {
  task: Item;
  editable: boolean;
  selected: boolean;
  onOpen: () => void;
  onMove: (status: TaskStatus) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: { draggable: !editable, droppable: false },
    transition: SORT_TRANSITION,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={kanbanCardClass({ draggable: editable, isDragging, selected })}
    >
      {editable && (
        <div className="absolute top-2 right-2 opacity-0 focus-within:opacity-100 hover:opacity-100 [div:hover>&]:opacity-100" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <RowActions
            label={`Move ${task.title}`}
            actions={TASK_STATUSES.filter((s) => s !== task.status).map((s) => ({ label: `Move to ${STATUS_LABEL[s]}`, onSelect: () => onMove(s) }))}
          />
        </div>
      )}
      <TaskCardBody task={task} onOpen={onOpen} selected={selected} />
    </div>
  );
}
