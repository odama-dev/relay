"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Builder } from "@/lib/kpi/builder";
import { formatDate, formatMonth } from "@/lib/format";
import { DataTable, type Column } from "@/components/data-table";
import { RowActions } from "@/components/row-actions";
import { PillButton } from "@/components/pill-button";
import { StatusBadge } from "@/components/status-badge";
import { FormField } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { DatePicker } from "@/components/date-picker";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveCycle } from "@/app/(app)/okr/actions";

type Cycle = Builder["cycles"][number];

export function CyclesPanel({ cycles }: { cycles: Cycle[] }) {
  const [editing, setEditing] = useState<Cycle | "new" | null>(null);
  const columns: Column<Cycle>[] = [
    { id: "name", header: "Cycle", primary: true, cell: (c) => c.name, sortValue: (c) => c.startDate },
    { id: "dates", header: "Dates", cell: (c) => <span className="tabular">{formatDate(c.startDate)} – {formatDate(c.endDate)}</span> },
    { id: "status", header: "Status", cell: (c) => <StatusBadge value={c.status === "active" ? "active" : c.status === "closed" ? "completed" : "draft"} label={c.status === "active" ? "Active" : c.status === "closed" ? "Closed" : "Draft"} /> },
    { id: "objectives", header: "Objectives", align: "right", cell: (c) => <span className="tabular">{c.objectives}</span> },
    { id: "actions", header: "", className: "w-12 text-right", cell: (c) => <RowActions label={`Actions for ${c.name}`} actions={[{ label: "Edit", icon: "edit", onSelect: () => setEditing(c) }]} /> },
  ];
  return (
    <div className="flex flex-col">
      <div className="bleed flex min-h-12 items-center justify-between gap-3 border-b py-2">
        <p className="text-muted-foreground text-caption">A quarter per cycle with monthly check-ins. OKRs don&apos;t affect reward.</p>
        <PillButton icon="add" onClick={() => setEditing("new")}>
          New cycle
        </PillButton>
      </div>
      <DataTable columns={columns} rows={cycles} getRowId={(c) => c.id} getRowHref={(c) => `/okr?cycle=${c.id}`} emptyTitle="No cycles yet" />
      {editing && <CycleDialog cycle={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CycleDialog({ cycle, onClose }: { cycle: Cycle | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(cycle?.name ?? "");
  const [startDate, setStart] = useState(cycle?.startDate ?? "");
  const [endDate, setEnd] = useState(cycle?.endDate ?? "");
  const [status, setStatus] = useState<"draft" | "active" | "closed">(cycle?.status ?? "draft");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await saveCycle(cycle?.id ?? null, { name, startDate, endDate, status });
            if (!res.ok) return void toast.error(res.error);
            toast.success("Cycle saved");
            onClose();
            router.refresh();
          }}
        >
          <DialogHeader>
            <DialogTitle>{cycle ? `Edit ${cycle.name}` : "New OKR cycle"}</DialogTitle>
          </DialogHeader>
          <FormField label="Name" htmlFor="cy-name" required>
            <Input id="cy-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q1 2027" />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Starts" htmlFor="cy-start" required>
              <DatePicker id="cy-start" value={startDate} onChange={setStart} className="w-full" />
            </FormField>
            <FormField label="Ends" htmlFor="cy-end" required>
              <DatePicker id="cy-end" value={endDate} onChange={setEnd} className="w-full" />
            </FormField>
          </div>
          <FormField label="Status" htmlFor="cy-status">
            <SelectField
              id="cy-status"
              value={status}
              onChange={(v) => setStatus(v as typeof status)}
              options={[
                { value: "draft", label: "Draft" },
                { value: "active", label: "Active" },
                { value: "closed", label: "Closed" },
              ]}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !startDate || !endDate}>
              Save cycle
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Objection = Builder["objections"][number];

/** Open objections — decided from the person's KPI page with their manager. */
export function ObjectionsPanel({ rows }: { rows: Objection[] }) {
  const columns: Column<Objection>[] = [
    { id: "person", header: "Person", primary: true, cell: (o) => o.person, sortValue: (o) => o.person },
    { id: "period", header: "Period", cell: (o) => formatMonth(o.period) },
    { id: "reason", header: "Reason", cell: (o) => <span className="block max-w-md truncate" title={o.reason}>{o.reason}</span> },
    { id: "filed", header: "Filed", cell: (o) => <span className="tabular">{formatDate(o.createdAt)}</span> },
    {
      id: "open",
      header: "",
      className: "text-right",
      cell: (o) => (
        <Link href={`/kpi?person=${o.personId}&tab=history`} className="text-muted-foreground hover:text-foreground text-caption">
          Decide
        </Link>
      ),
    },
  ];
  return <DataTable columns={columns} rows={rows} getRowId={(o) => o.id} emptyTitle="No open objections" />;
}
