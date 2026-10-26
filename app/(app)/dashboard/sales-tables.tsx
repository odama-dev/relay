"use client";

import type { ActiveClient, MyInvoice } from "@/lib/dashboard/queries";
import { formatDateShort } from "@/lib/format";
import { DataTable, type Column } from "@/components/data-table";
import { ClientPanel, useOpenClient, useOpenClientId } from "@/components/clients/client-panel";
import { InvoiceStatusMenu } from "@/components/invoice/invoice-status-menu";
import { ClientPaymentMenu } from "@/components/clients/client-payment-menu";
import { MoneyText } from "@/components/money-text";
import { Icon, type IconName } from "@/components/icon";

const REQUEST_ICON: Record<MyInvoice["requests"][number]["status"], { icon: IconName; className: string; label: string }> = {
  paid: { icon: "success", className: "text-success", label: "Paid" },
  pending: { icon: "time", className: "text-muted-foreground", label: "Pending" },
  late: { icon: "warning", className: "text-destructive", label: "Late" },
  expired: { icon: "warning", className: "text-warning", label: "Link expired" },
  void: { icon: "error", className: "text-muted-foreground", label: "Void" },
};

/** SL-2 — what's been paid, and what's late, on the invoices you created. */
export function MyInvoicesTable({ rows }: { rows: MyInvoice[] }) {
  const columns: Column<MyInvoice>[] = [
    { id: "number", header: "Invoice", primary: true, cell: (r) => <span className="tabular">{r.number ?? "Draft"}</span>, sortValue: (r) => r.number },
    { id: "client", header: "Client", cell: (r) => r.client, sortValue: (r) => r.client },
    {
      id: "terms",
      header: "Terms",
      cell: (r) => (
        <span className="flex items-center gap-1">
          {r.requests.map((q, n) => {
            const s = REQUEST_ICON[q.status];
            return (
              <span key={n} title={`${q.label} · ${s.label} · due ${formatDateShort(q.dueDate)}`} className={s.className}>
                <Icon name={s.icon} size={13} />
                <span className="sr-only">
                  {q.label}: {s.label}
                </span>
              </span>
            );
          })}
        </span>
      ),
    },
    { id: "status", header: "Status", cell: (r) => <InvoiceStatusMenu id={r.id} status={r.status} manual={r.manualStatus} canEdit />, sortValue: (r) => r.status },
    {
      id: "remaining",
      header: "Remaining",
      align: "right",
      cell: (r) => (r.remaining > 0 ? <MoneyText value={r.remaining} currency={r.currency} /> : <span className="text-muted-foreground">—</span>),
      sortValue: (r) => r.remaining,
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      getRowHref={(r) => `/invoices/${r.id}`}
      pageSize={8}
      emptyTitle="No open invoices"
      emptyDescription="Nothing open, and none paid in the last 30 days."
    />
  );
}

const PAYMENT_ORDER: Record<ActiveClient["payment"], number> = { late: 0, due_soon: 1, on_track: 2, none: 3 };

/** SL-3 — your clients with active work, and their payment status (set by hand when it's known better). */
export function ActiveClientsTable({ rows, canEdit }: { rows: ActiveClient[]; canEdit: boolean }) {
  const openClient = useOpenClient();
  const openId = useOpenClientId();
  const columns: Column<ActiveClient>[] = [
    { id: "name", header: "Client", primary: true, cell: (r) => r.name, sortValue: (r) => r.name },
    { id: "projects", header: "Active projects", align: "right", cell: (r) => <span className="tabular">{r.projects}</span>, sortValue: (r) => r.projects },
    {
      id: "payment",
      header: "Payment",
      cell: (r) => <ClientPaymentMenu id={r.id} status={r.payment} auto={r.autoPayment} manual={r.manual} canEdit={canEdit} />,
      sortValue: (r) => PAYMENT_ORDER[r.payment],
    },
  ];
  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        onRowClick={(r) => openClient(r.id)}
        isRowSelected={(r) => r.id === openId}
        pageSize={10}
        emptyTitle="No clients with active projects"
      />
      <ClientPanel ids={rows.map((r) => r.id)} scope="Active clients" />
    </>
  );
}
