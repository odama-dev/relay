"use client";

import type { InvoiceRow } from "@/lib/invoices/queries";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { MoneyText } from "@/components/money-text";
import { INVOICE_KIND_LABELS, INVOICE_STATUS_LABELS, PLATFORM_LABELS } from "@/lib/invoices/pure";
import { formatDateShort } from "@/lib/format";

/**
 * M5.9 — number, client, project, terms, currency, total, paid, outstanding,
 * due date, status; Phase 2 · M9 adds type, platform, sent and paid dates.
 */
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
    { id: "kind", header: "Type", sortValue: (r) => r.kind ?? "", cell: (r) => (r.kind ? INVOICE_KIND_LABELS[r.kind] : <span className="text-muted-foreground">—</span>) },
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
    { id: "platform", header: "Paid via", sortValue: (r) => r.platform, cell: (r) => PLATFORM_LABELS[r.platform] },
    { id: "sent", header: "Sent", sortValue: (r) => r.sentOn ?? "", cell: (r) => <span className="tabular">{r.sentOn ? formatDateShort(r.sentOn) : "—"}</span> },
    { id: "due", header: "Next due", sortValue: (r) => r.nextDue ?? "", cell: (r) => <span className="tabular">{r.nextDue ? formatDateShort(r.nextDue) : "—"}</span> },
    { id: "paidOn", header: "Paid on", sortValue: (r) => r.paidOn ?? "", cell: (r) => <span className="tabular">{r.paidOn ? formatDateShort(r.paidOn) : "—"}</span> },
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
