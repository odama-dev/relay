"use client";

import { useId, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import type { SectionRow, TaskRow } from "@/lib/tasks/queries";
import { moveTask } from "@/app/(app)/tasks/actions";
import { SORT_TRANSITION } from "@/components/kanban-physics";
import { TaskLine } from "./task-row";

type Cols = Record<string, string[]>;

function columnsFrom(sections: SectionRow[], tasks: TaskRow[]): Cols {
  const cols: Cols = Object.fromEntries(sections.map((s) => [s.id, []]));
  for (const t of [...tasks].sort((a, b) => a.position - b.position)) cols[t.sectionId]?.push(t.id);
  return cols;
}

/**
 * List view (M2.3): tasks grouped by section, reordered and moved between
 * sections by drag. Optimistic; the server re-renders with the saved order.
 */
export function TaskList({
  sections,
  tasks,
  canEdit,
  openTaskId,
  onOpen,
  renderSectionHeader,
  renderSectionFooter,
}: {
  sections: SectionRow[];
  tasks: TaskRow[];
  canEdit: (task: TaskRow) => boolean;
  openTaskId: string | null;
  onOpen: (id: string) => void;
  renderSectionHeader: (section: SectionRow, count: number) => ReactNode;
  renderSectionFooter?: (section: SectionRow) => ReactNode;
}) {
  const [draft, setDraft] = useState<{ source: TaskRow[]; cols: Cols } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Stable ids so dnd-kit's accessibility attributes match between server and client.
  const dndId = useId();
  const cols = draft && draft.source === tasks ? draft.cols : columnsFrom(sections, tasks);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const sectionOf = (id: string) => (cols[id] ? id : Object.keys(cols).find((s) => cols[s]!.includes(id)));

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const id = String(active.id);
    const from = sectionOf(id);
    const to = sectionOf(String(over.id));
    if (!from || !to || from === to) return;
    const target = cols[to]!;
    const at = target.indexOf(String(over.id));
    setDraft({
      source: tasks,
      cols: { ...cols, [from]: cols[from]!.filter((x) => x !== id), [to]: [...target.slice(0, at === -1 ? target.length : at), id, ...target.slice(at === -1 ? target.length : at)] },
    });
  };

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    const id = String(active.id);
    const to = over ? sectionOf(String(over.id)) : undefined;
    if (!over || !to) return setDraft(null);
    let list = cols[to]!;
    const from = list.indexOf(id);
    const overIndex = list.indexOf(String(over.id));
    if (overIndex !== -1 && overIndex !== from) list = arrayMove(list, from, overIndex);
    const next = { ...cols, [to]: list };
    const original = byId.get(id);
    const i = list.indexOf(id);
    if (original?.sectionId === to && columnsFrom(sections, tasks)[to]!.indexOf(id) === i) return setDraft(null);
    setDraft({ source: tasks, cols: next });
    const res = await moveTask(id, { sectionId: to, prevId: list[i - 1] ?? null, nextId: list[i + 1] ?? null });
    if (!res.ok) {
      toast.error(res.error);
      setDraft(null);
    }
  };

  const active = activeId ? byId.get(activeId) : undefined;

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={({ active: a }) => setActiveId(String(a.id))}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setDraft(null);
      }}
    >
      <div className="flex flex-col gap-6">
        {sections.map((section) => {
          const ids = cols[section.id] ?? [];
          return (
            <section key={section.id} className="flex flex-col gap-1">
              {renderSectionHeader(section, ids.length)}
              <SortableContext id={section.id} items={ids} strategy={verticalListSortingStrategy}>
                <SectionDrop id={section.id} empty={ids.length === 0}>
                  {ids.map((id) => {
                    const task = byId.get(id);
                    return task ? (
                      <SortableLine key={id} task={task} editable={canEdit(task)} selected={openTaskId === id} onOpen={() => onOpen(id)} />
                    ) : null;
                  })}
                </SectionDrop>
              </SortableContext>
              {renderSectionFooter?.(section)}
            </section>
          );
        })}
      </div>
      <DragOverlay>{active ? <TaskLine task={active} onOpen={() => {}} selected /> : null}</DragOverlay>
    </DndContext>
  );
}

function SectionDrop({ id, empty, children }: { id: string; empty: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`flex min-h-2 flex-col rounded-lg transition-colors ${isOver ? "bg-hover" : ""}`}>
      {children}
      {empty && <p className="text-muted-foreground px-9 py-2 text-caption">No tasks</p>}
    </div>
  );
}

function SortableLine({ task, editable, selected, onOpen }: { task: TaskRow; editable: boolean; selected: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: { draggable: !editable, droppable: false },
    transition: SORT_TRANSITION,
  });
  return (
    <TaskLine
      task={task}
      onOpen={onOpen}
      selected={selected}
      innerRef={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      dragHandleProps={editable ? { ...attributes, ...listeners, "aria-label": `Drag ${task.title}` } : undefined}
      isDragging={isDragging}
    />
  );
}
