"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Builder } from "@/lib/kpi/builder";
import { DIRECTION_LABELS, SOURCE_LABELS } from "@/lib/kpi/definition";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { RowActions } from "@/components/row-actions";
import { PillButton } from "@/components/pill-button";
import { setMetricStatus } from "@/app/(app)/performance/actions";
import { MetricDialog } from "./metric-dialog";

type Metric = Builder["metrics"][number];

export function MetricsPanel({ metrics, taskTypes }: { metrics: Builder["metrics"]; taskTypes: Builder["taskTypes"] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Metric | "new" | null>(null);
  const columns: Column<Metric>[] = [
    {
      id: "name",
      header: "Metric",
      primary: true,
      cell: (m) => m.name,
      sortValue: (m) => m.name,
    },
    { id: "definition", header: "Definition", cell: (m) => <span className="block max-w-md truncate" title={m.sentence}>{m.sentence}</span> },
    { id: "source", header: "Data", cell: (m) => (m.definition ? SOURCE_LABELS[m.definition.source] : "—"), sortValue: (m) => m.definition?.source },
    { id: "direction", header: "Better", cell: (m) => DIRECTION_LABELS[m.direction], sortValue: (m) => m.direction },
    { id: "used", header: "In templates", align: "right", cell: (m) => <span className="tabular">{m.usedIn}</span>, sortValue: (m) => m.usedIn },
    {
      id: "flags",
      header: "",
      cell: (m) => (
        <span className="flex gap-1.5">
          {m.manual && <StatusBadge value="warning" label="Not automated yet" />}
          {m.status === "archived" && <StatusBadge value="archived" />}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (m) => (
        <RowActions
          label={`Actions for ${m.name}`}
          actions={[
            { label: "Edit", icon: "edit", onSelect: () => setEditing(m) },
            {
              label: m.status === "archived" ? "Restore" : "Archive",
              icon: m.status === "archived" ? "restore" : "archive",
              onSelect: async () => {
                const res = await setMetricStatus(m.id, m.status === "archived" ? "active" : "archived");
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
    <div className="flex flex-col">
      <div className="bleed flex min-h-12 items-center justify-between gap-3 border-b py-2">
        <p className="text-muted-foreground text-caption">Metrics are definitions, not code: data + filter + calculation + direction.</p>
        <PillButton icon="add" onClick={() => setEditing("new")}>
          New metric
        </PillButton>
      </div>
      <DataTable columns={columns} rows={metrics} getRowId={(m) => m.id} isRowInactive={(m) => m.status === "archived"} pageSize={30} emptyTitle="No metrics yet" />
      {editing && <MetricDialog metric={editing === "new" ? null : editing} all={metrics} taskTypes={taskTypes} onClose={() => setEditing(null)} />}
    </div>
  );
}
