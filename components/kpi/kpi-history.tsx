"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { KpiHistoryRow } from "@/lib/kpi/queries";
import { formatDate, formatMonth } from "@/lib/format";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { RowActions } from "@/components/row-actions";
import { FormField } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { decideObjection, fileObjection } from "@/app/(app)/kpi/actions";
import { KpiItemsTable } from "./kpi-items-table";

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** Recorded results (never recomputed), with objections within 7 days. */
export function KpiHistory({ rows, isSelf, canDecide }: { rows: KpiHistoryRow[]; isSelf: boolean; canDecide: boolean }) {
  const router = useRouter();
  const [objecting, setObjecting] = useState<KpiHistoryRow | null>(null);
  const [deciding, setDeciding] = useState<{ id: string; reason: string } | null>(null);

  const columns: Column<KpiHistoryRow>[] = [
    {
      id: "period",
      header: "Period",
      primary: true,
      cell: (r) => (r.periodKind === "monthly" ? formatMonth(r.periodStart) : `${formatMonth(r.periodStart)} – ${formatMonth(r.periodEnd)}`),
      sortValue: (r) => r.periodStart,
    },
    { id: "score", header: "Score", align: "right", cell: (r) => <span className="tabular">{r.score === null ? "—" : Math.round(r.score)}</span>, sortValue: (r) => r.score },
    { id: "grade", header: "Grade", cell: (r) => r.grade ?? "—", sortValue: (r) => r.grade },
    {
      id: "flags",
      header: "",
      cell: (r) => (
        <span className="flex flex-wrap gap-1.5">
          {r.calibration && <StatusBadge value="neutral" label="Calibration" />}
          {r.objections.map((o) => (
            <StatusBadge key={o.id} value={o.status === "open" ? "pending" : o.status === "upheld" ? "approved" : "rejected"} label={`Objection ${o.status}`} />
          ))}
        </span>
      ),
    },
    { id: "recorded", header: "Recorded", cell: (r) => <span className="tabular">{formatDate(r.computedAt)}</span>, sortValue: (r) => r.computedAt.getTime() },
    {
      id: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (r) => {
        const open = r.objections.find((o) => o.status === "open");
        return (
          <RowActions
            label="Result actions"
            actions={[
              {
                label: "Object to this result",
                icon: "flag",
                hidden: !isSelf || Date.now() - r.computedAt.getTime() > WEEK || Boolean(open),
                onSelect: () => setObjecting(r),
              },
              { label: "Decide the objection", icon: "approvals", hidden: !canDecide || !open, onSelect: () => open && setDeciding({ id: open.id, reason: open.reason }) },
            ]}
          />
        );
      },
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        renderExpanded={(r) => <KpiItemsTable rows={r.items} />}
        isRowExpandable={() => true}
        expandLabel={(r) => `Show the items for ${r.periodStart}`}
        emptyTitle="No recorded results yet"
        emptyDescription="A month's KPI is recorded on the 1st of the next month."
      />
      {objecting && (
        <ObjectionDialog
          row={objecting}
          onClose={() => setObjecting(null)}
          onDone={() => {
            setObjecting(null);
            router.refresh();
          }}
        />
      )}
      {deciding && (
        <DecideDialog
          objection={deciding}
          onClose={() => setDeciding(null)}
          onDone={() => {
            setDeciding(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function ObjectionDialog({ row, onClose, onDone }: { row: KpiHistoryRow; onClose: () => void; onDone: () => void }) {
  const [metricKey, setMetricKey] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const res = await fileObjection(row.id, { metricKey, reason });
            setBusy(false);
            if (!res.ok) return void toast.error(res.error);
            toast.success("Objection sent to HR and your manager");
            onDone();
          }}
        >
          <DialogHeader>
            <DialogTitle>Object to this result</DialogTitle>
            <DialogDescription>HR decides with your direct manager. Objections close 7 days after a result is recorded.</DialogDescription>
          </DialogHeader>
          <FormField label="Item" htmlFor="obj-item">
            <SelectField id="obj-item" value={metricKey} onChange={setMetricKey} noneLabel="The whole result" options={row.items.map((i) => ({ value: i.metricKey, label: i.name }))} />
          </FormField>
          <FormField label="What's wrong" htmlFor="obj-reason" required>
            <Textarea id="obj-reason" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || reason.trim().length < 10}>
              Send objection
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DecideDialog({ objection, onClose, onDone }: { objection: { id: string; reason: string }; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const decide = async (upheld: boolean) => {
    setBusy(true);
    const res = await decideObjection(objection.id, { upheld, note });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(upheld ? "Upheld" : "Turned down");
    onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <div className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Decide the objection</DialogTitle>
            <DialogDescription>{objection.reason}</DialogDescription>
          </DialogHeader>
          <FormField label="Note for the person" htmlFor="dec-note" required>
            <Textarea id="dec-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="tertiary" disabled={busy || !note.trim()} onClick={() => void decide(false)}>
              Turn down
            </Button>
            <Button type="button" disabled={busy || !note.trim()} onClick={() => void decide(true)}>
              Uphold
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
