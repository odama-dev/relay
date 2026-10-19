"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDate, formatDuration } from "@/lib/format";
import { reviewOutOfScope } from "./actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/states";
import type { OosRow } from "@/lib/time/approvals";


/** M4.3 — approve (change request) or reject (in-scope), one by one or in bulk, with an optional note. */
export function OosQueue({ rows }: { rows: OosRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (rows.length === 0) {
    return <EmptyState icon="flag" title="No out-of-scope work waiting" description="When someone flags time as out of scope on your projects, you decide here." />;
  }

  const decide = async (ids: string[], decision: "approved" | "rejected") => {
    setBusy(true);
    const res = await reviewOutOfScope({ ids, decision, note });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(`${res.data.count} ${decision === "approved" ? "approved as change requests" : "rejected — counted as in-scope work"}`);
    setSelected(new Set());
    setNote("");
    router.refresh();
  };

  const all = selected.size === rows.length;
  const ids = [...selected];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox
          aria-label="Select all"
          checked={all ? true : selected.size ? "indeterminate" : false}
          onCheckedChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))}
        />
        <span className="text-muted-foreground text-body">{selected.size ? `${selected.size} selected` : "Select entries to decide in bulk"}</span>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the person (optional)" className="h-8 max-w-xs" aria-label="Decision note" />
        <Button size="sm" disabled={!selected.size || busy} onClick={() => decide(ids, "approved")}>
          Approve
        </Button>
        <Button size="sm" variant="tertiary" disabled={!selected.size || busy} onClick={() => decide(ids, "rejected")}>
          Reject
        </Button>
      </div>
      <ul className="flex flex-col divide-y divide-black/4 dark:divide-white/5">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start gap-3 rounded-lg px-3 py-2.5 text-body">
            <Checkbox
              className="mt-0.5"
              aria-label={`Select ${r.task} by ${r.person}`}
              checked={selected.has(r.id)}
              onCheckedChange={(v) => {
                const next = new Set(selected);
                if (v) next.add(r.id);
                else next.delete(r.id);
                setSelected(next);
              }}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span>
                <span className="font-medium">{r.task}</span>
                <span className="text-muted-foreground"> · {r.project}</span>
              </span>
              <span className="text-muted-foreground text-caption">
                {r.person} · {formatDate(r.date)} · <span className="tabular">{formatDuration(r.minutes)}</span>
              </span>
              {r.note && <span className="mt-0.5">“{r.note}”</span>}
            </span>
            <span className="flex gap-1">
              <Button size="compact" variant="ghost" disabled={busy} onClick={() => decide([r.id], "approved")}>
                Approve
              </Button>
              <Button size="compact" variant="ghost" disabled={busy} onClick={() => decide([r.id], "rejected")}>
                Reject
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
