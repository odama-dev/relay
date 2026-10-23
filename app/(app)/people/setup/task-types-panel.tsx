"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RowActions } from "@/components/row-actions";
import { StatusBadge } from "@/components/status-badge";
import { addTaskType, renameTaskType, setTaskTypeArchived } from "./actions";

type TaskType = { id: string; name: string; key: string; archived: boolean; usage: number };

/** Task types (PRD Phase 2 "Task"): add, rename, archive. The key never changes, so metrics keep matching. */
export function TaskTypesPanel({ types }: { types: TaskType[] }) {
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
        Every task has a type. KPI metrics count tasks by type — Content, Bug, Revision — so archive a type instead of renaming it into something else.
      </p>
      <ul className="flex flex-col divide-y divide-black/4 dark:divide-white/5">
        {types.map((t) => (
          <li key={t.id} className="flex h-10 items-center gap-3 rounded-lg px-3 text-body hover:bg-hover">
            {renaming?.id === t.id ? (
              <form
                className="flex flex-1 gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await act(renameTaskType(t.id, { name: renaming.name }), "Renamed")) setRenaming(null);
                }}
              >
                <Input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: t.id, name: e.target.value })} className="h-7" />
                <Button size="sm" type="submit">Save</Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setRenaming(null)}>Cancel</Button>
              </form>
            ) : (
              <>
                <span className="flex-1">{t.name}</span>
                <span className="text-muted-foreground tabular text-caption">{t.usage > 0 ? `${t.usage} tasks` : "Unused"}</span>
                {t.archived && <StatusBadge value="archived" />}
                <RowActions
                  label={`Actions for ${t.name}`}
                  actions={[
                    { label: "Rename", icon: "edit", onSelect: () => setRenaming({ id: t.id, name: t.name }) },
                    {
                      label: t.archived ? "Restore" : "Archive",
                      icon: t.archived ? "restore" : "archive",
                      onSelect: () => void act(setTaskTypeArchived(t.id, !t.archived)),
                    },
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
          if (await act(addTaskType({ name: draft }), "Task type added")) setDraft("");
        }}
      >
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New type, e.g. Research" className="max-w-xs" aria-label="New task type" />
        <Button type="submit" variant="tertiary" disabled={!draft.trim()}>Add</Button>
      </form>
    </div>
  );
}
