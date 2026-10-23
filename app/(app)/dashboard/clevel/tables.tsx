"use client";

import type { ContractType, UserRole } from "@prisma/client";
import { roleLabel } from "@/lib/roles";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";

const CONTRACT_LABEL: Record<ContractType, string> = { retainer: "Retainer", fixed: "Fixed", time_and_material: "Time & material" };
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { MemberAvatar } from "@/components/member-avatar";
import { cn } from "@/lib/utils";

const idr = (v: number | null) => (v == null ? "—" : formatMoney(v, "IDR"));
const neg = (v: number | null) => (v != null && v < 0 ? "text-destructive" : undefined);
const hours = (v: number | null) => (v == null ? "—" : `${Math.round(v * 10) / 10}h`);

type ClientRow = { id: string; name: string; revenue: number; margin: number | null; marginPct: number | null; marginKnown: boolean; receivable: number };

/** §4.4 — top clients by revenue in the period. */
export function ClientsTable({ rows }: { rows: ClientRow[] }) {
  const columns: Column<ClientRow>[] = [
    { id: "name", header: "Client", primary: true, cell: (r) => <span className="truncate">{r.name}</span>, sortValue: (r) => r.name },
    { id: "revenue", header: "Revenue", align: "right", cell: (r) => <span className="tabular">{idr(r.revenue)}</span>, sortValue: (r) => r.revenue },
    {
      id: "margin",
      header: "Margin",
      align: "right",
      cell: (r) => (
        <span className={cn("tabular", neg(r.margin))} title={r.marginKnown ? undefined : "Some hours have no cost yet"}>
          {idr(r.margin)}
          {!r.marginKnown && r.margin !== null && <span className="text-warning">*</span>}
        </span>
      ),
      sortValue: (r) => r.margin,
    },
    { id: "pct", header: "Margin %", align: "right", cell: (r) => <span className={cn("tabular", neg(r.marginPct))}>{formatPercent(r.marginPct)}</span>, sortValue: (r) => r.marginPct },
    { id: "receivable", header: "Receivable", align: "right", cell: (r) => <span className="tabular">{r.receivable ? idr(r.receivable) : "—"}</span>, sortValue: (r) => r.receivable },
  ];
  return <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} getRowHref={(r) => `/clients/${r.id}`} pageSize={10} emptyTitle="No revenue in this period" />;
}

type MarginRow = {
  id: string;
  code: string;
  name: string;
  client: string;
  contractType: ContractType | null;
  status: string;
  period: { revenue: number; cost: number; margin: number; marginPct: number | null };
  lifetime: { hours: number };
  effectiveRate: number | null;
  oosApprovedHours: number;
  oosValue: number | null;
  projectedMargin: number | null;
  costKnown: boolean;
  burn: Burn | null;
};

type Burn = { burnPct: number | null; progressPct: number | null; ahead: boolean | null };

/** A running fixed-price project: hours burnt vs tasks done, not a margin (Metric Dictionary). */
function BurnCell({ burn }: { burn: Burn }) {
  return (
    <span
      className={cn("tabular", burn.ahead && "text-warning")}
      title={burn.ahead ? "Budget is burning faster than the work gets done" : "Running fixed-price project — budget burn vs progress, not margin"}
    >
      {burn.burnPct === null ? "No budget" : `${burn.burnPct}% burnt`} · {burn.progressPct === null ? "no tasks" : `${burn.progressPct}% done`}
    </span>
  );
}

/** §5.4 — margin per client project; sortable on every number. */
export function ProjectMarginTable({ rows }: { rows: MarginRow[] }) {
  const columns: Column<MarginRow>[] = [
    { id: "project", header: "Project", primary: true, cell: (r) => r.name, sortValue: (r) => r.name.toLowerCase() },
    { id: "code", header: "Code", cell: (r) => <span className="tabular">{r.code}</span>, sortValue: (r) => r.code },
    { id: "client", header: "Client", primary: true, cell: (r) => r.client, sortValue: (r) => r.client },
    { id: "type", header: "Contract", cell: (r) => r.contractType ? CONTRACT_LABEL[r.contractType] : "—", sortValue: (r) => r.contractType },
    { id: "revenue", header: "Revenue", align: "right", cell: (r) => <span className="tabular">{idr(r.period.revenue)}</span>, sortValue: (r) => r.period.revenue },
    { id: "cost", header: "Cost", align: "right", cell: (r) => <span className="tabular">{idr(r.period.cost)}</span>, sortValue: (r) => r.period.cost },
    {
      id: "margin",
      header: "Margin",
      align: "right",
      cell: (r) =>
        r.burn ? (
          <BurnCell burn={r.burn} />
        ) : (
          <span className={cn("tabular", neg(r.period.margin))} title={r.costKnown ? undefined : "Some hours have no cost yet"}>
            {idr(r.period.margin)}
            {!r.costKnown && <span className="text-warning">*</span>}
          </span>
        ),
      sortValue: (r) => r.period.margin,
    },
    {
      id: "pct",
      header: "Margin %",
      align: "right",
      cell: (r) => (r.burn ? "—" : <span className={cn("tabular", neg(r.period.marginPct))}>{formatPercent(r.period.marginPct)}</span>),
      sortValue: (r) => r.period.marginPct,
    },
    { id: "rate", header: "Rate / hour", align: "right", cell: (r) => <span className="tabular">{idr(r.effectiveRate)}</span>, sortValue: (r) => r.effectiveRate },
    {
      id: "oos",
      header: "Out of scope",
      align: "right",
      cell: (r) => <span className="tabular">{idr(r.oosValue)}</span>,
      sortValue: (r) => r.oosValue,
    },
    {
      id: "oosHours",
      header: "OOS approved",
      align: "right",
      cell: (r) => <span className={"tabular"}>{r.oosApprovedHours ? hours(r.oosApprovedHours) : "—"}</span>,
      sortValue: (r) => r.oosApprovedHours ?? 0,
    },
    { id: "projected", header: "Projected margin", align: "right", cell: (r) => <span className={cn("tabular", neg(r.projectedMargin))}>{idr(r.projectedMargin)}</span>, sortValue: (r) => r.projectedMargin },
  ];
  return <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} getRowHref={(r) => `/projects/${r.id}`} pageSize={10} emptyTitle="No client projects in this period" />;
}

type PersonRow = {
  id: string;
  name: string;
  role: UserRole;
  available: number | null;
  logged: number;
  billable: number;
  utilization: number | null;
  target: number;
  status: "overload" | "on_target" | "under" | null;
  emptyDays: number;
};

const UTIL_STATUS = { overload: { value: "over_budget", label: "Overload" }, on_target: { value: "on_track", label: "On target" }, under: { value: "warning", label: "Under target" } } as const;

/** §6.3 — per person: available, logged, billable, utilization vs target, status. */
export function PeopleUtilizationTable({ rows }: { rows: PersonRow[] }) {
  const columns: Column<PersonRow>[] = [
    { id: "name", header: "Person", cell: (r) => r.name, sortValue: (r) => r.name },
    { id: "role", header: "Role", cell: (r) => roleLabel(r.role), sortValue: (r) => roleLabel(r.role) },
    { id: "available", header: "Available", align: "right", cell: (r) => <span className="tabular">{hours(r.available)}</span>, sortValue: (r) => r.available },
    {
      id: "logged",
      header: "Logged",
      align: "right",
      cell: (r) => (
        <span className="tabular" title={r.emptyDays ? `${r.emptyDays} past workday${r.emptyDays === 1 ? "" : "s"} without time — utilization may read low` : undefined}>
          {hours(r.logged)}
          {r.emptyDays > 0 && <span className="text-warning"> · {r.emptyDays}d empty</span>}
        </span>
      ),
      sortValue: (r) => r.logged,
    },
    { id: "billable", header: "Billable", align: "right", cell: (r) => <span className="tabular">{hours(r.billable)}</span>, sortValue: (r) => r.billable },
    { id: "util", header: "Utilization", align: "right", cell: (r) => <span className="tabular">{formatPercent(r.utilization)}</span>, sortValue: (r) => r.utilization },
    { id: "target", header: "Target", align: "right", cell: (r) => <span className="tabular">{formatPercent(r.target)}</span>, sortValue: (r) => r.target },
    {
      id: "status",
      header: "Status",
      cell: (r) => (r.status ? <StatusBadge value={UTIL_STATUS[r.status].value} label={UTIL_STATUS[r.status].label} /> : "No capacity"),
      sortValue: (r) => r.status,
    },
  ];
  return <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} pageSize={12} emptyTitle="Nobody to count yet" />;
}

type MarginEdgeRow = {
  id: string;
  name: string;
  client: string;
  contractType: ContractType | null;
  period: { margin: number };
  costKnown: boolean;
  burn: Burn | null;
  endDate: string | null;
  members: { id: string; name: string; avatarUrl: string | null }[];
};

/** Overview: the three best and three worst project margins in the period, best first. */
export function MarginEdgesTable({ rows }: { rows: MarginEdgeRow[] }) {
  const columns: Column<MarginEdgeRow>[] = [
    { id: "project", header: "Project", primary: true, cell: (r) => r.name, sortValue: (r) => r.name.toLowerCase() },
    { id: "client", header: "Client", cell: (r) => r.client, sortValue: (r) => r.client },
    { id: "type", header: "Contract", cell: (r) => (r.contractType ? CONTRACT_LABEL[r.contractType] : "—"), sortValue: (r) => r.contractType },
    {
      id: "margin",
      header: "Margin",
      cell: (r) =>
        r.burn ? (
          <BurnCell burn={r.burn} />
        ) : (
          <span className={cn("tabular", neg(r.period.margin))} title={r.costKnown ? undefined : "Some hours have no cost yet"}>
            {idr(r.period.margin)}
            {!r.costKnown && <span className="text-warning">*</span>}
          </span>
        ),
      sortValue: (r) => r.period.margin,
    },
    { id: "due", header: "Due date", cell: (r) => <span className="tabular">{r.endDate ? formatDate(r.endDate) : "—"}</span>, sortValue: (r) => r.endDate ?? "" },
    {
      id: "members",
      header: "Members",
      cell: (r) =>
        r.members.length ? (
          <span className="flex items-center -space-x-1.5" title={r.members.map((m) => m.name).join(", ")}>
            {r.members.slice(0, 4).map((m) => (
              <MemberAvatar key={m.id} seed={m.id} src={m.avatarUrl} name={m.name} size={20} className="ring-background ring-2" />
            ))}
            {r.members.length > 4 && <span className="tabular pl-2.5">+{r.members.length - 4}</span>}
          </span>
        ) : (
          "—"
        ),
      sortValue: (r) => r.members.length,
    },
  ];
  return <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} getRowHref={(r) => `/projects/${r.id}`} layout="fixed" emptyTitle="No client projects in this period" />;
}
