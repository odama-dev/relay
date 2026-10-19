"use client";

import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { statusColor } from "@/components/status-badge";
import { cn } from "@/lib/utils";

/**
 * One droppable, sortable column, shared by every Kanban board (Projects,
 * Tasks, …): a soft grey lane running the board's height, headed by the
 * status dot, a bold label and a count chip.
 */
export function KanbanColumn({
  status,
  label,
  itemIds,
  isTarget = false,
  children,
}: {
  status: string;
  label: string;
  /** Card ids in display order — drives in-column sorting. */
  itemIds: string[];
  /** The dragged card currently sits in this column. */
  isTarget?: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const highlighted = isOver || isTarget;

  return (
    // 18.4rem = the original 16rem column, 15% wider.
    <div
      className={cn(
        "bg-surface-1 flex w-[18.4rem] shrink-0 flex-col gap-1 rounded-xl p-2 transition-colors duration-300",
        highlighted && "bg-[color-mix(in_oklab,var(--surface-1),var(--foreground)_3%)]",
      )}
    >
      <div className="flex h-8 items-center gap-2 px-2">
        <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: statusColor(status) }} />
        <h3 className="truncate text-body font-semibold">{label}</h3>
        <span
          className={cn(
            "bg-accent text-muted-foreground grid h-[18px] min-w-[18px] place-items-center rounded-[5px] px-1 text-caption tabular-nums",
            "transition-[scale,color] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
            highlighted && "text-foreground motion-safe:scale-125",
          )}
        >
          {itemIds.length}
        </span>
      </div>
      <SortableContext id={status} items={itemIds} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2">
          {children}
        </div>
      </SortableContext>
    </div>
  );
}
