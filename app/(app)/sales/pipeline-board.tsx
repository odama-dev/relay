"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import type { DealView } from "@/lib/sales/queries";
import { formatDateShort, formatMoney } from "@/lib/format";
import { KanbanColumn } from "@/components/kanban-column";
import { KanbanDragTilt, SORT_TRANSITION, kanbanCardClass, useKanbanDropAnimation } from "@/components/kanban-physics";
import { useKanbanDnd } from "@/components/use-kanban-dnd";
import { RowActions } from "@/components/row-actions";
import { MoneyText } from "@/components/money-text";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/form-field";
import { moveDeal } from "./actions";
import type { SalesChoices } from "./deal-dialog";

type Item = DealView & { status: string; boardOrder: number };
type Result = { ok: true } | { ok: false; error: string };

/**
 * The pipeline as a board: one column per stage, in the stages' order.
 * Dragging a deal changes its stage; Lost asks why; Won offers the project.
 * Columns show the IDR total of their deals.
 */
export function PipelineBoard({
  deals,
  choices,
  onOpen,
  onEdit,
}: {
  deals: DealView[];
  choices: SalesChoices;
  /** A card opens the deal panel. */
  onOpen: (id: string) => void;
  /** Opens the deal dialog (e.g. to create the project once won). */
  onEdit: (id: string) => void;
}) {
  const router = useRouter();
  const dropAnimation = useKanbanDropAnimation();
  const dndId = useId();
  // Hidden stages (Stages dialog) leave the board; their deals still count in the totals.
  const visibleStages = choices.stages.filter((s) => !s.isHidden);
  const stageIds = visibleStages.map((s) => s.id);
  const items: Item[] = deals.map((d, i) => ({ ...d, status: d.stageId, boardOrder: i }));
  const [asking, setAsking] = useState<{ title: string } | null>(null);
  const answer = useRef<((reason: string | null) => void) | null>(null);

  const askReason = (title: string) =>
    new Promise<string | null>((resolve) => {
      answer.current = resolve;
      setAsking({ title });
    });

  const onMove = async (id: string, stageId: string): Promise<Result> => {
    const stage = choices.stages.find((s) => s.id === stageId);
    const deal = deals.find((d) => d.id === id);
    let lostReason: string | undefined;
    if (stage?.category === "lost") {
      const reason = await askReason(deal?.title ?? "this deal");
      // Cancelled: an empty error keeps the card where it was without a toast.
      if (reason === null) return { ok: false, error: "" };
      lostReason = reason || undefined;
    }
    const res = await moveDeal(id, { stageId, lostReason });
    if (!res.ok) return res;
    router.refresh();
    if (stage?.category === "won" && !deal?.project && choices.canCreateProject) {
      toast.success(`${deal?.title ?? "Deal"} won`, { action: { label: "Create project", onClick: () => onEdit(id) } });
    }
    return { ok: true };
  };

  const { cols, byId, handlers, activeItem, statusOf, moveTo } = useKanbanDnd<string, Item>({
    items,
    statuses: stageIds,
    canReorder: false,
    onMove: (id, stageId) => onMove(id, stageId),
  });
  const target = activeItem ? statusOf(activeItem.id) : undefined;
  const overlay = activeItem ? byId.get(activeItem.id) : undefined;

  return (
    <DndContext id={dndId} {...handlers}>
      <div className="-mx-1 flex min-h-[calc(100dvh-16rem)] gap-2 overflow-x-auto px-1 pb-2">
        {visibleStages.map((stage) => {
          const ids = cols[stage.id] ?? [];
          const total = ids.reduce((sum, id) => sum + (byId.get(id)?.valueIdr ?? 0), 0);
          return (
            <KanbanColumn
              key={stage.id}
              status={stage.id}
              tone={stage.category}
              label={stage.name}
              itemIds={ids}
              isTarget={target === stage.id}
              aside={total > 0 ? formatMoney(total, "IDR", { compact: true }) : undefined}
            >
              {ids.map((id) => {
                const deal = byId.get(id);
                if (!deal) return null;
                return (
                  <Card
                    key={id}
                    deal={deal}
                    editable={choices.canManage}
                    stages={visibleStages.filter((s) => s.id !== stage.id)}
                    onOpen={() => onOpen(id)}
                    onMove={(s) => moveTo(id, s)}
                  />
                );
              })}
            </KanbanColumn>
          );
        })}
      </div>
      <DragOverlay dropAnimation={dropAnimation}>
        {overlay ? (
          <KanbanDragTilt>
            <div className={kanbanCardClass({})}>
              <DealCardBody deal={overlay} />
            </div>
          </KanbanDragTilt>
        ) : null}
      </DragOverlay>
      {asking && (
        <LostReasonDialog
          title={asking.title}
          onDone={(reason) => {
            answer.current?.(reason);
            answer.current = null;
            setAsking(null);
          }}
        />
      )}
    </DndContext>
  );
}

function Card({
  deal,
  editable,
  stages,
  onOpen,
  onMove,
}: {
  deal: Item;
  editable: boolean;
  stages: SalesChoices["stages"];
  onOpen: () => void;
  onMove: (stageId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    disabled: { draggable: !editable, droppable: false },
    transition: SORT_TRANSITION,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      className={kanbanCardClass({ draggable: editable, isDragging })}
    >
      {editable && (
        <div className="absolute top-2 right-2 opacity-0 focus-within:opacity-100 hover:opacity-100 [div:hover>&]:opacity-100" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <RowActions label={`Move ${deal.title}`} actions={stages.map((s) => ({ label: `Move to ${s.name}`, onSelect: () => onMove(s.id) }))} />
        </div>
      )}
      <DealCardBody deal={deal} onOpen={onOpen} />
    </div>
  );
}

export function DealCardBody({ deal, onOpen }: { deal: DealView; onOpen?: () => void }) {
  return (
    <div className="flex flex-col gap-1.5 text-body">
      {onOpen ? (
        // The keyboard way in: the card itself is the drag handle.
        <button
          type="button"
          className="pr-6 text-left font-medium outline-none focus-visible:underline"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {deal.title}
        </button>
      ) : (
        <span className="pr-6 font-medium">{deal.title}</span>
      )}
      <span className="text-muted-foreground truncate text-caption">
        {[deal.company?.name ?? deal.client?.name ?? deal.prospectName, deal.person?.name].filter(Boolean).join(" · ") || "—"}
      </span>
      <span className="flex items-center justify-between gap-2">
        <MoneyText value={deal.value} currency={deal.currency} />
        {deal.category === "open" && <span className="text-muted-foreground tabular text-caption">{deal.probability}%</span>}
      </span>
      <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-caption">
        {deal.owner && <span className="truncate">{deal.owner.name}</span>}
        {deal.lastContactOn && <span className="tabular">Contacted {formatDateShort(deal.lastContactOn)}</span>}
        {deal.project && <span className="tabular">{deal.project.code}</span>}
        {deal.stale && <StatusBadge value="stale" label={`${deal.daysInStage}d in stage`} />}
      </span>
    </div>
  );
}

function LostReasonDialog({ title, onDone }: { title: string; onDone: (reason: string | null) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onDone(null)}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onDone(reason.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>Why was {title} lost?</DialogTitle>
            <DialogDescription>Optional — lost reasons help the Sales report.</DialogDescription>
          </DialogHeader>
          <FormField label="Lost reason" htmlFor="lost-reason">
            <Input id="lost-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Went with another studio" />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={() => onDone(null)}>
              Cancel
            </Button>
            <Button type="submit">
              Move to lost
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
