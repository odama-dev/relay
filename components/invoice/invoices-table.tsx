"use client";

import type { InvoiceRow } from "@/lib/invoices/queries";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { MoneyText } from "@/components/money-text";
import { INVOICE_STATUS_LABELS } from "@/lib/invoices/pure";
import { formatDateShort } from "@/lib/format";

/** M5.9 — number, client, project, terms, currency, total, paid, outstanding, due date, status. */
export function InvoicesTable({ rows, hideProject }: { rows: InvoiceRow[]; hideProject?: boolean }) {
  const columns: Column<InvoiceRow>[] = [
    {
      id: "number",
      header: "Invoice",
      sortValue: (r) => r.number ?? "",
      cell: (r) => r.number ?? "Draft",
    },
    { id: "issued", header: "Issued", sortValue: (r) => r.issueDate, cell: (r) => <span className="tabular">{formatDateShort(r.issueDate)}</span> },
    ...(hideProject
      ? []
      : [
          {
            id: "client",
            header: "Client", primary: true,
            sortValue: (r: InvoiceRow) => r.client.name,
            cell: (r: InvoiceRow) => r.client.name,
          },
          {
            id: "project",
            header: "Project",
            primary: true,
            sortValue: (r: InvoiceRow) => r.project.code,
            cell: (r: InvoiceRow) => <span className="tabular">{r.project.code}</span>,
          },
        ]),
    {
      id: "terms",
      header: "Terms",
      cell: (r) => (
        <span className="block max-w-48 truncate" title={r.terms.map((t) => t.label).join(" · ")}>
          {r.terms.map((t) => t.label).join(" · ")}
        </span>
      ),
    },
    { id: "total", header: "Total", align: "right", sortValue: (r) => r.total, cell: (r) => <MoneyText value={r.total} currency={r.currency} /> },
    { id: "paid", header: "Paid", align: "right", sortValue: (r) => r.amountPaid, cell: (r) => <MoneyText value={r.amountPaid} currency={r.currency} muted={r.amountPaid === 0} /> },
    {
      id: "outstanding",
      header: "Outstanding",
      align: "right",
      sortValue: (r) => r.outstanding,
      cell: (r) => <MoneyText value={r.outstanding} currency={r.currency} muted={r.outstanding === 0} />,
    },
    { id: "due", header: "Next due", sortValue: (r) => r.nextDue ?? "", cell: (r) => <span className="tabular">{r.nextDue ? formatDateShort(r.nextDue) : "—"}</span> },
    { id: "status", header: "Status", sortValue: (r) => r.status, cell: (r) => <StatusBadge value={r.status} label={INVOICE_STATUS_LABELS[r.status]} /> },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      getRowHref={(r) => `/invoices/${r.id}`}
      emptyTitle="No invoices"
      emptyDescription="Invoices created from client projects appear here."
    />
  );
}
