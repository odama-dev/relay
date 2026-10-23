"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { WorkLogRow } from "@/lib/kpi/log-queries";
import { LOG_KINDS } from "@/lib/kpi/logs";
import { formatDate } from "@/lib/format";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { RowActions } from "@/components/row-actions";
import { FormField } from "@/components/form-field";
import { AmountInput } from "@/components/amount-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Icon } from "@/components/icon";
import { deleteWorkLog, reviewWorkLog } from "@/app/(app)/work-log/actions";

const tagLabel = (kind: WorkLogRow["kind"], tag: string) => LOG_KINDS[kind].tags?.find((t) => t.value === tag)?.label ?? tag.replace(/_/g, " ");

/** Logged work: shots, ideas, errors… with their review state. In "review" mode, the reviewer's actions. */
export function WorkLogTable({ rows, mode }: { rows: WorkLogRow[]; mode: "mine" | "review" }) {
  const router = useRouter();
  const [reviewing, setReviewing] = useState<WorkLogRow | null>(null);
  const columns: Column<WorkLogRow>[] = [
    { id: "date", header: "Date", cell: (r) => <span className="tabular">{formatDate(r.occurredOn)}</span>, sortValue: (r) => r.occurredOn },
    { id: "kind", header: "Type", cell: (r) => LOG_KINDS[r.kind].label, sortValue: (r) => r.kind },
    {
      id: "title",
      header: "Entry",
      primary: true,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{r.title}</span>
          {r.link && (
            <a href={r.link} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Open link" onClick={(e) => e.stopPropagation()}>
              <Icon name="external" size={13} />
            </a>
          )}
          {r.hasEvidence && (
            <a href={`/api/files/evidence/${r.id}`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Open evidence" onClick={(e) => e.stopPropagation()}>
              <Icon name="file" size={13} />
            </a>
          )}
        </span>
      ),
      sortValue: (r) => r.title,
    },
    { id: "tags", header: "Tags", cell: (r) => (r.tags.length ? r.tags.map((t) => tagLabel(r.kind, t)).join(", ") : <span className="text-muted-foreground">—</span>) },
    { id: "project", header: "Project", cell: (r) => (r.project ? <span className="tabular">{r.project.code}</span> : <span className="text-muted-foreground">—</span>), sortValue: (r) => r.project?.code },
    {
      id: "value",
      header: "Value",
      align: "right",
      cell: (r) =>
        r.value !== null && LOG_KINDS[r.kind].value ? (
          <span className="tabular" title={LOG_KINDS[r.kind].value}>
            {r.value}
            {r.total !== null ? ` of ${r.total}` : ""}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      sortValue: (r) => r.value,
    },
    ...(mode === "review" ? [{ id: "person", header: "Person", cell: (r: WorkLogRow) => r.person.name, sortValue: (r: WorkLogRow) => r.person.name }] : []),
    {
      id: "status",
      header: "Status",
      cell: (r) => (
        <span title={r.reviewNote ?? undefined}>
          <StatusBadge value={r.status === "submitted" ? "pending" : r.status} label={r.status === "submitted" ? "Waiting for review" : undefined} />
        </span>
      ),
      sortValue: (r) => r.status,
    },
    { id: "reviewer", header: "Reviewed by", cell: (r) => r.reviewer ?? <span className="text-muted-foreground">—</span>, sortValue: (r) => r.reviewer },
    {
      id: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (r) => (
        <RowActions
          label={`Actions for ${r.title}`}
          actions={[
            { label: "Review", icon: "approvals", hidden: mode !== "review", onSelect: () => setReviewing(r) },
            {
              label: "Delete",
              icon: "delete",
              destructive: true,
              hidden: mode !== "mine" || r.status !== "submitted" || !r.mine,
              onSelect: async () => {
                const res = await deleteWorkLog(r.id);
                if (!res.ok) return void toast.error(res.error);
                router.refresh();
              },
            },
          ]}
        />
      ),
    },
  ];
  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        pageSize={20}
        renderExpanded={(r) => (r.description ? <p className="text-body whitespace-pre-line">{r.description}</p> : null)}
        isRowExpandable={(r) => Boolean(r.description)}
        expandLabel={(r) => `Show notes for ${r.title}`}
        emptyTitle={mode === "review" ? "Nothing to review" : "Nothing logged yet"}
        emptyDescription={mode === "review" ? "Entries from your team show up here." : "Log shots, ideas, releases and more — they feed your KPI."}
      />
      {reviewing && (
        <ReviewDialog
          row={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function ReviewDialog({ row, onClose, onDone }: { row: WorkLogRow; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [value, setValue] = useState<number | null>(row.value);
  const [busy, setBusy] = useState(false);
  const cfg = LOG_KINDS[row.kind];
  const decide = async (approve: boolean) => {
    setBusy(true);
    const res = await reviewWorkLog(row.id, { approve, note, value });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(approve ? "Approved" : "Rejected");
    onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <div className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {cfg.label}: {row.title}
            </DialogTitle>
            <DialogDescription>
              {row.person.name} · {formatDate(row.occurredOn)}
              {row.description ? ` — ${row.description}` : ""}
            </DialogDescription>
          </DialogHeader>
          {cfg.value && (
            <FormField label={cfg.value} htmlFor="rv-value">
              <AmountInput id="rv-value" value={value} onChange={setValue} placeholder="0" />
            </FormField>
          )}
          <FormField label="Note" htmlFor="rv-note" hint="Required when you reject.">
            <Textarea id="rv-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="tertiary" disabled={busy || !note.trim()} onClick={() => void decide(false)}>
              Reject
            </Button>
            <Button type="button" disabled={busy} onClick={() => void decide(true)}>
              Approve
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
