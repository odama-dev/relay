"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DealView } from "@/lib/sales/queries";
import { formatDateShort } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { PillButton } from "@/components/pill-button";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/link-button";
import { ViewToggle, LIST_KANBAN_OPTIONS, type ViewMode } from "@/components/view-toggle";
import { DataTable, type Column } from "@/components/data-table";
import { MoneyText } from "@/components/money-text";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/states";
import { icons } from "@/components/icon";
import { DealDialog, type SalesChoices } from "./deal-dialog";
import { PipelineBoard } from "./pipeline-board";
import { StagesDialog } from "./stages-dialog";
import { ImportDialog } from "./import-dialog";

type Open = { kind: "deal"; id?: string } | { kind: "stages" } | { kind: "import" } | null;

/** Pipeline page body: header actions, the board / list toggle and the dialogs they open. */
export function PipelineView({ deals, choices, header, filters }: { deals: DealView[]; choices: SalesChoices; header: React.ReactNode; filters: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view: ViewMode = params.get("view") === "list" ? "list" : "kanban";
  const [open, setOpen] = useState<Open>(() => (params.get("deal") ? { kind: "deal", id: params.get("deal")! } : null));
  const openDeal = deals.find((d) => open?.kind === "deal" && d.id === open.id);

  const setView = (v: ViewMode) => {
    const next = new URLSearchParams(params.toString());
    if (v === "kanban") next.delete("view");
    else next.set("view", v);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Pipeline"
        compact
        actions={
          <>
            <LinkButton variant="ghost" size="sm" icon="bar" href="/sales/report">
              Report
            </LinkButton>
            {choices.canManage && (
              <>
                <Button variant="ghost" size="sm" leadingIcon={icons.upload} onClick={() => setOpen({ kind: "import" })}>
                  Import CSV
                </Button>
                <Button variant="ghost" size="sm" leadingIcon={icons.settings} onClick={() => setOpen({ kind: "stages" })}>
                  Stages
                </Button>
                <PillButton onClick={() => setOpen({ kind: "deal" })}>New deal</PillButton>
              </>
            )}
          </>
        }
      />
      {header}
      <div className="bleed flex flex-wrap items-center gap-2 border-b py-2">
        <ViewToggle value={view} onChange={setView} options={LIST_KANBAN_OPTIONS} />
        <div className="min-w-0 flex-1">{filters}</div>
      </div>
      <div className="pt-4">
        {deals.length === 0 && !params.get("q") && !params.get("owner") ? (
          <EmptyState
            icon="target"
            title="No deals yet"
            description="Add your leads here — or import them from Attio — and move them through the stages until they're won."
            action={choices.canManage ? <PillButton onClick={() => setOpen({ kind: "deal" })}>New deal</PillButton> : null}
          />
        ) : view === "kanban" ? (
          <PipelineBoard deals={deals} choices={choices} onOpen={(id) => setOpen({ kind: "deal", id })} />
        ) : (
          <DealsTable deals={deals} choices={choices} onOpen={(id) => setOpen({ kind: "deal", id })} />
        )}
      </div>
      {open?.kind === "deal" && (open.id ? openDeal : true) && <DealDialog deal={openDeal} choices={choices} onClose={() => setOpen(null)} />}
      {open?.kind === "stages" && <StagesDialog stages={choices.stages} onClose={() => setOpen(null)} />}
      {open?.kind === "import" && <ImportDialog onClose={() => setOpen(null)} />}
    </div>
  );
}

function DealsTable({ deals, choices, onOpen }: { deals: DealView[]; choices: SalesChoices; onOpen: (id: string) => void }) {
  const stageName = new Map(choices.stages.map((s) => [s.id, s.name]));
  const columns: Column<DealView>[] = [
    {
      id: "title",
      header: "Deal",
      primary: true,
      sortValue: (d) => d.title,
      cell: (d) => (
        <button type="button" className="text-left hover:underline" onClick={() => onOpen(d.id)}>
          {d.title}
        </button>
      ),
    },
    { id: "client", header: "Client", sortValue: (d) => d.client?.name ?? d.prospectName ?? "", cell: (d) => d.client?.name ?? <span className="text-muted-foreground">{d.prospectName}</span> },
    {
      id: "stage",
      header: "Stage",
      sortValue: (d) => choices.stages.findIndex((s) => s.id === d.stageId),
      cell: (d) => <StatusBadge value={d.category} label={stageName.get(d.stageId) ?? "—"} />,
    },
    { id: "value", header: "Value", align: "right", sortValue: (d) => d.valueIdr ?? d.value, cell: (d) => <MoneyText value={d.value} currency={d.currency} /> },
    { id: "prob", header: "Prob.", align: "right", sortValue: (d) => d.probability, cell: (d) => <span className="tabular">{d.probability}%</span> },
    {
      id: "weighted",
      header: "Weighted (IDR)",
      align: "right",
      sortValue: (d) => (d.valueIdr ?? 0) * d.probability,
      cell: (d) => (d.category === "open" && d.valueIdr !== null ? <MoneyText value={Math.round((d.valueIdr * d.probability) / 100)} currency="IDR" /> : "—"),
    },
    { id: "close", header: "Expected close", sortValue: (d) => d.expectedClose ?? "", cell: (d) => <span className="tabular">{d.expectedClose ? formatDateShort(d.expectedClose) : "—"}</span> },
    { id: "owner", header: "Owner", sortValue: (d) => d.owner?.name ?? "", cell: (d) => d.owner?.name ?? "—" },
    { id: "source", header: "Source", sortValue: (d) => d.leadSource ?? "", cell: (d) => d.leadSource ?? "—" },
    {
      id: "age",
      header: "In stage",
      align: "right",
      sortValue: (d) => d.daysInStage,
      cell: (d) => (d.stale ? <StatusBadge value="stale" label={`${d.daysInStage}d`} /> : <span className="tabular">{d.daysInStage}d</span>),
    },
    { id: "project", header: "Project", sortValue: (d) => d.project?.code ?? "", cell: (d) => (d.project ? <span className="tabular">{d.project.code}</span> : "—") },
  ];
  return <DataTable columns={columns} rows={deals} getRowId={(d) => d.id} emptyTitle="No deals match" emptyDescription="Clear the search or filters." />;
}
