"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDate, formatDuration, formatRelative } from "@/lib/format";
import { reviewCorrection } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/states";
import type { CorrectionRow } from "@/lib/time/approvals";

type Side = NonNullable<CorrectionRow["current"]>;

const describe = (s: Side) => `${formatDuration(s.minutes)} · ${formatDate(s.date)} · ${s.target}${s.note ? ` — ${s.note}` : ""}`;

/** M3.5 — review time corrections; a rejection needs a reason, which the requester receives. */
export function CorrectionsQueue({ rows }: { rows: CorrectionRow[] }) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  if (rows.length === 0) {
    return <EmptyState icon="approvals" title="No corrections waiting" description="Requests to change time in locked weeks appear here for review." />;
  }

  const decide = async (id: string, decision: "approved" | "rejected") => {
    setBusy(id);
    const res = await reviewCorrection(id, decision, notes[id]);
    setBusy(null);
    if (!res.ok) return void toast.error(res.error);
    toast.success(decision === "approved" ? "Correction applied" : "Correction rejected");
    router.refresh();
  };

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.id} className="bg-surface-3 shadow-surface-2 flex flex-col gap-2 rounded-xl p-3 text-body">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span>
              <span className="font-medium">{r.requester}</span> <span className="text-muted-foreground">· {r.project} · {formatRelative(r.createdAt)}</span>
            </span>
          </div>
          <div className="grid gap-1 sm:grid-cols-[80px_1fr]">
            {r.current && (
              <>
                <span className="text-muted-foreground text-caption">Now</span>
                <span className={r.proposed ? "" : "line-through"}>{describe(r.current)}</span>
              </>
            )}
            <span className="text-muted-foreground text-caption">{r.proposed ? (r.current ? "Change to" : "Add") : "Request"}</span>
            <span className="font-medium">{r.proposed ? describe(r.proposed) : "Remove this entry"}</span>
            <span className="text-muted-foreground text-caption">Reason</span>
            <span>{r.reason}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={notes[r.id] ?? ""}
              onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
              placeholder="Note (required to reject)"
              className="h-8 max-w-xs"
              aria-label="Review note"
            />
            <Button size="sm" disabled={busy === r.id} onClick={() => decide(r.id, "approved")}>
              Approve
            </Button>
            <Button size="sm" variant="tertiary" disabled={busy === r.id} onClick={() => decide(r.id, "rejected")}>
              Reject
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
