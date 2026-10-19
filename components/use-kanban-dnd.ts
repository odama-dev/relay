"use client";

import { useState } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { toast } from "sonner";

type Item<S extends string> = { id: string; status: S; boardOrder: number };
type Columns<S extends string> = Record<S, string[]>;
type Result = { ok: true } | { ok: false; error: string };

export type KanbanNeighbours = { prevId: string | null; nextId: string | null };

/** Server order: by boardOrder, ties keep the incoming (server) order. */
function columnsFrom<S extends string>(items: Item<S>[], statuses: readonly S[]): Columns<S> {
  const cols = Object.fromEntries(statuses.map((s) => [s, [] as string[]])) as Columns<S>;
  const sorted = items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.boardOrder - b.item.boardOrder || a.i - b.i);
  for (const { item } of sorted) cols[item.status]?.push(item.id);
  return cols;
}

function neighboursOf(col: string[], id: string): KanbanNeighbours {
  const i = col.indexOf(id);
  return { prevId: col[i - 1] ?? null, nextId: col[i + 1] ?? null };
}

/**
 * Drag state shared by every Kanban board: cross-column moves and in-column
 * reordering, applied optimistically and persisted through `onMove`. The
 * optimistic columns are tied to the `items` they were derived from, so once
 * the server re-renders with fresh items they're dropped — nothing to reconcile.
 */
export function useKanbanDnd<S extends string, T extends Item<S>>({
  items,
  statuses,
  canReorder,
  onMove,
}: {
  items: T[];
  statuses: readonly S[];
  /** In-column reordering allowed (cross-column moves are gated per card). */
  canReorder: boolean;
  onMove: (id: string, status: S, neighbours: KanbanNeighbours) => Promise<Result>;
}) {
  const [draft, setDraft] = useState<{ source: T[]; cols: Columns<S> } | null>(null);
  const [active, setActive] = useState<{ id: string; from: S; index: number } | null>(null);

  const cols = draft && draft.source === items ? draft.cols : columnsFrom(items, statuses);
  const byId = new Map(items.map((i) => [i.id, i]));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columnOf = (id: string): S | undefined =>
    (statuses as readonly string[]).includes(id)
      ? (id as S)
      : statuses.find((s) => cols[s].includes(id));

  const setCols = (next: Columns<S>) => setDraft({ source: items, cols: next });

  async function commit(id: string, status: S, next: Columns<S>) {
    setCols(next);
    const res = await onMove(id, status, neighboursOf(next[status], id));
    if (!res.ok) {
      setDraft(null);
      toast.error(res.error);
    }
  }

  /** Non-drag move (card menu, preview panel): to the bottom of `status`. */
  function moveTo(id: string, status: S) {
    const from = columnOf(id);
    if (!from || from === status) return;
    void commit(id, status, {
      ...cols,
      [from]: cols[from].filter((x) => x !== id),
      [status]: [...cols[status], id],
    });
  }

  const handlers = {
    sensors,
    collisionDetection: closestCorners,
    onDragStart: ({ active: a }: DragStartEvent) => {
      const id = String(a.id);
      const from = columnOf(id);
      if (from) setActive({ id, from, index: cols[from].indexOf(id) });
    },
    // Crossing into another column moves the card there live, so the target
    // column opens a gap for it while dragging.
    onDragOver: ({ active: a, over }: DragOverEvent) => {
      if (!over) return;
      const id = String(a.id);
      const from = columnOf(id);
      const to = columnOf(String(over.id));
      if (!from || !to || from === to) return;
      const target = cols[to];
      const overIndex = target.indexOf(String(over.id));
      const index = overIndex === -1 ? target.length : overIndex;
      setCols({
        ...cols,
        [from]: cols[from].filter((x) => x !== id),
        [to]: [...target.slice(0, index), id, ...target.slice(index)],
      });
    },
    onDragEnd: ({ active: a, over }: DragEndEvent) => {
      const start = active;
      setActive(null);
      const id = String(a.id);
      const to = over ? columnOf(String(over.id)) : undefined;
      if (!start || !over || !to) return setDraft(null);

      let next = cols;
      const overIndex = cols[to].indexOf(String(over.id));
      const index = cols[to].indexOf(id);
      if (overIndex !== -1 && overIndex !== index) {
        next = { ...cols, [to]: arrayMove(cols[to], index, overIndex) };
      }

      const sameColumn = to === start.from;
      const finalIndex = next[to].indexOf(id);
      if (sameColumn && (finalIndex === start.index || !canReorder)) return setDraft(null);
      void commit(id, to, next);
    },
    onDragCancel: () => {
      setActive(null);
      setDraft(null);
    },
  };

  const activeItem = active ? byId.get(active.id) : undefined;
  const statusOf = (id: string) => columnOf(id);

  return { cols, byId, handlers, activeItem, statusOf, moveTo };
}
