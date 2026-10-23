"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { StageView } from "@/lib/sales/queries";
import { STAGE_CATEGORIES } from "@/lib/validation";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/select-field";
import { RowActions } from "@/components/row-actions";
import { StatusDot } from "@/components/status-badge";
import { icons } from "@/components/icon";
import { createStage, deleteStage, moveStage, updateStage } from "./actions";

type Category = (typeof STAGE_CATEGORIES)[number];
const CATEGORY_LABEL: Record<Category, string> = { open: "Open", won: "Won", lost: "Lost" };
type Draft = { name: string; category: Category; probability: number };

/**
 * Pipeline stages (Sales module): name, category and default probability,
 * in board order. Reports read the category, so a stage's name is free.
 * A stage with deals can't be deleted until they're moved.
 */
export function StagesDialog({ stages, onClose }: { stages: StageView[]; onClose: () => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", category: "open", probability: 50 });
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    if (done) toast.success(done);
    setEditing(null);
    router.refresh();
  };

  const form = (id: string | "new") => (
    <form
      className="grid grid-cols-[1fr_110px_80px_auto] items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void act(() => (id === "new" ? createStage(draft) : updateStage(id, draft)), id === "new" ? "Stage added" : "Stage saved");
      }}
    >
      <Input aria-label="Stage name" autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Stage name" />
      <SelectField
        aria-label="Category"
        value={draft.category}
        onChange={(v) => {
          const category = v as Category;
          setDraft({ ...draft, category, probability: category === "won" ? 100 : category === "lost" ? 0 : draft.probability });
        }}
        options={STAGE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
      />
      <Input
        aria-label="Default probability, percent"
        type="number"
        min={0}
        max={100}
        disabled={draft.category !== "open"}
        value={draft.probability}
        onChange={(e) => setDraft({ ...draft, probability: Number(e.target.value) })}
      />
      <span className="flex gap-1">
        <Button type="submit" size="sm" disabled={busy || !draft.name.trim()}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
          Cancel
        </Button>
      </span>
    </form>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Pipeline stages</DialogTitle>
          <DialogDescription>Each stage is Open, Won or Lost — reports count by category. A deal entering a stage takes its probability.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-1 text-body">
          {stages.map((s, i) =>
            editing === s.id ? (
              <li key={s.id}>{form(s.id)}</li>
            ) : (
              <li key={s.id} className="hover:bg-accent/40 flex h-10 items-center gap-3 rounded-lg px-2">
                <StatusDot value={s.category} label={CATEGORY_LABEL[s.category]} />
                <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                <span className="text-muted-foreground w-16 text-caption">{CATEGORY_LABEL[s.category]}</span>
                <span className="text-muted-foreground tabular w-10 text-right text-caption">{s.probability}%</span>
                <span className="text-muted-foreground tabular w-16 text-right text-caption">{s.deals} deals</span>
                <RowActions
                  label={`${s.name} actions`}
                  actions={[
                    {
                      label: "Edit",
                      icon: "edit",
                      onSelect: () => {
                        setDraft({ name: s.name, category: s.category, probability: s.probability });
                        setEditing(s.id);
                      },
                    },
                    { label: "Move up", hidden: i === 0, onSelect: () => void act(() => moveStage(s.id, -1)) },
                    { label: "Move down", hidden: i === stages.length - 1, onSelect: () => void act(() => moveStage(s.id, 1)) },
                    { label: "Delete", icon: "delete", destructive: true, onSelect: () => void act(() => deleteStage(s.id), "Stage deleted") },
                  ]}
                />
              </li>
            ),
          )}
          {editing === "new" && <li>{form("new")}</li>}
        </ul>
        {editing !== "new" && (
          <div>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={icons.add}
              onClick={() => {
                setDraft({ name: "", category: "open", probability: 50 });
                setEditing("new");
              }}
            >
              Add stage
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
