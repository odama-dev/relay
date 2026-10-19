"use client";

import type { ExpectedPayment } from "@/lib/finance/queries";
import type { ForecastMonth } from "@/lib/finance/pure";
import { formatDate, formatMoney, formatMonth, formatPercent } from "@/lib/format";
import { DataTable, type Column } from "@/components/data-table";
import { MoneyText } from "@/components/money-text";
import { StatusBadge } from "@/components/status-badge";

const idr = (v: number | null) => (v == null ? "—" : formatMoney(v, "IDR"));
const amount = (v: number) => <span className="tabular">{v ? idr(v) : "—"}</span>;

/** `received`: already in this month (current month only), so coverage counts it. */
export type ForecastRow = ForecastMonth & { received: number; trend: number | null; target: number | null };

/** The forecast per month, by source; target and coverage only for whoever may see targets. */
export function ForecastTable({ rows, showTarget }: { rows: ForecastRow[]; showTarget: boolean }) {
  const columns: Column<ForecastRow>[] = [
    { id: "month", header: "Month", primary: true, cell: (r) => formatMonth(r.month) },
    { id: "received", header: "Received", align: "right", cell: (r) => amount(r.received) },
    { id: "invoiced", header: "Invoiced", align: "right", cell: (r) => amount(r.invoiced) },
    { id: "overdue", header: "Overdue", align: "right", cell: (r) => <span className={r.overdue ? "text-warning" : undefined}>{amount(r.overdue)}</span> },
    { id: "retainer", header: "Retainer", align: "right", cell: (r) => amount(r.retainer) },
    { id: "contract", header: "Contract remaining", align: "right", cell: (r) => amount(r.contract) },
    { id: "draft", header: "Draft", align: "right", cell: (r) => amount(r.draft) },
    { id: "total", header: "Total", align: "right", cell: (r) => <span className="tabular [font-variation-settings:'wght'_500,'opsz'_14]">{idr(r.received + r.total)}</span> },
    { id: "trend", header: "Trend", align: "right", cell: (r) => <span className="tabular">{idr(r.trend)}</span> },
    ...(showTarget
      ? [
          { id: "target", header: "Target", align: "right" as const, cell: (r: ForecastRow) => <span className="tabular">{idr(r.target)}</span> },
          {
            id: "coverage",
            header: "Coverage",
            align: "right" as const,
            cell: (r: ForecastRow) => <span className="tabular">{r.target ? formatPercent(((r.received + r.total) / r.target) * 100) : "—"}</span>,
          },
        ]
      : []),
  ];
  return <DataTable columns={columns} rows={rows} getRowId={(r) => r.month} emptyTitle="Nothing expected" />;
}

const STATUS = { pending: "Pending", overdue: "Overdue", draft: "Draft" } as const;

/** Payment requests due in the next 90 days (and every overdue one), soonest first. */
export function ExpectedPaymentsTable({ rows }: { rows: ExpectedPayment[] }) {
  const columns: Column<ExpectedPayment>[] = [
    { id: "due", header: "Due date", sortValue: (r) => r.due, cell: (r) => <span className="tabular">{formatDate(r.due)}</span> },
    { id: "invoice", header: "Invoice", primary: true, sortValue: (r) => r.invoice, cell: (r) => <span className="tabular">{r.invoice}</span> },
    { id: "client", header: "Client", sortValue: (r) => r.client, cell: (r) => r.client },
    { id: "label", header: "Payment", sortValue: (r) => r.label, cell: (r) => r.label },
    { id: "amount", header: "Amount", align: "right", sortValue: (r) => r.idr ?? -1, cell: (r) => <MoneyText value={r.amount} currency={r.currency} /> },
    {
      id: "idr",
      header: "IDR estimate",
      align: "right",
      sortValue: (r) => r.idr ?? -1,
      cell: (r) => <span className="tabular" title={r.currency !== "IDR" ? "Estimate at the reference rate" : undefined}>{r.currency === "IDR" ? "—" : idr(r.idr)}</span>,
    },
    { id: "status", header: "Status", sortValue: (r) => r.status, cell: (r) => <StatusBadge value={r.status} label={STATUS[r.status]} /> },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      getRowHref={(r) => `/invoices/${r.invoiceId}`}
      emptyTitle="Nothing due in the next 90 days"
      emptyDescription="Sent and draft invoices with payment requests due soon appear here."
    />
  );
}
