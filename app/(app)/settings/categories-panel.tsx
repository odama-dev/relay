"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RowActions } from "@/components/row-actions";
import { StatusBadge } from "@/components/status-badge";
import { addCategory, deleteCategory, moveCategory, renameCategory, setCategoryActive } from "./actions";

type Category = { id: string; name: string; isActive: boolean; usage: number };

/** M3.2 — non-billable categories: add, rename, reorder, deactivate; delete only when unused. */
export function CategoriesPanel({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const act = async (p: Promise<{ ok: boolean; error?: string }>, done?: string) => {
    const res = await p;
    if (!res.ok) toast.error(res.error);
    else {
      if (done) toast.success(done);
      router.refresh();
    }
    return res.ok;
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-muted-foreground text-body">
        Time logged to a category has no project and is never billable. Categories with logged time can&apos;t be deleted, only deactivated.
      </p>
      <ul className="flex flex-col divide-y divide-black/4 dark:divide-white/5">
        {categories.map((c, i) => (
          <li key={c.id} className="flex h-10 items-center gap-3 rounded-lg px-3 text-body hover:bg-hover">
            {renaming?.id === c.id ? (
              <form
                className="flex flex-1 gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await act(renameCategory(c.id, { name: renaming.name }), "Renamed")) setRenaming(null);
                }}
              >
                <Input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: c.id, name: e.target.value })} className="h-7" />
                <Button size="sm" type="submit">Save</Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setRenaming(null)}>Cancel</Button>
              </form>
            ) : (
              <>
                <span className="flex-1">{c.name}</span>
                <span className="text-muted-foreground tabular text-caption">{c.usage > 0 ? `${c.usage} entries` : "Unused"}</span>
                {!c.isActive && <StatusBadge value="deactivated" label="Inactive" />}
                <RowActions
                  label={`Actions for ${c.name}`}
                  actions={[
                    { label: "Rename", icon: "edit", onSelect: () => setRenaming({ id: c.id, name: c.name }) },
                    { label: "Move up", icon: "arrowUp", hidden: i === 0, onSelect: () => void act(moveCategory(c.id, "up")) },
                    { label: "Move down", icon: "arrowDown", hidden: i === categories.length - 1, onSelect: () => void act(moveCategory(c.id, "down")) },
                    {
                      label: c.isActive ? "Deactivate" : "Activate",
                      icon: c.isActive ? "archive" : "restore",
                      onSelect: () => void act(setCategoryActive(c.id, !c.isActive)),
                    },
                    { label: "Delete", icon: "delete", destructive: true, hidden: c.usage > 0, onSelect: () => void act(deleteCategory(c.id), "Deleted") },
                  ]}
                />
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act(addCategory({ name: draft }), "Category added")) setDraft("");
        }}
      >
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New category, e.g. Workshop" className="max-w-xs" aria-label="New category" />
        <Button type="submit" variant="tertiary" disabled={!draft.trim()}>Add</Button>
      </form>
    </div>
  );
}
