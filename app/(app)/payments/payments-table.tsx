"use client";

import { DataTable, type Column } from "@/components/data-table";
import { MoneyText } from "@/components/money-text";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/format";
import { MatchPaymentButton } from "./match-payment";

export type PaymentRow = {
  id: string;
  amount: number;
  currency: string;
  paidAt: string;
  invoice: { id: string; number: string | null; billToName: string } | null;
  request: string | null;
  externalRef: string;
  channel: string;
  /** IDR settled for a non-IDR payment. */
  settledIdr: number | null;
  matchedBy: string | null;
  needsReview: boolean;
};

export function PaymentsTable({
  rows,
  timezone,
  matchOptions,
  emptyTitle,
  emptyDescription,
}: {
  rows: PaymentRow[];
  timezone: string;
  /** Open payment requests; set only on the Unmatched tab for people who may match. */
  matchOptions?: { id: string; label: string }[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  const columns: Column<PaymentRow>[] = [
    { id: "amount", header: "Amount", align: "right", sortValue: (r) => r.amount, cell: (r) => <MoneyText value={r.amount} currency={r.currency} /> },
    { id: "paid", header: "Paid at", sortValue: (r) => r.paidAt, cell: (r) => <span className="tabular">{formatDateTime(r.paidAt, timezone)}</span> },
    {
      id: "invoice",
      header: "Invoice",
      primary: true,
      sortValue: (r) => r.invoice?.number ?? "",
      cell: (r) => (r.invoice ? <span className="tabular">{r.invoice.number ?? "Draft"}</span> : "Unmatched"),
    },
    { id: "request", header: "Payment", sortValue: (r) => r.request ?? "", cell: (r) => r.request ?? `Ref ${r.externalRef}` },
    { id: "client", header: "Client", sortValue: (r) => r.invoice?.billToName ?? "", cell: (r) => r.invoice?.billToName ?? "—" },
    { id: "channel", header: "Channel", sortValue: (r) => r.channel, cell: (r) => r.channel },
    {
      id: "settled",
      header: "Settled (IDR)",
      align: "right",
      sortValue: (r) => r.settledIdr ?? -1,
      cell: (r) => (r.settledIdr !== null ? <MoneyText value={r.settledIdr} currency="IDR" /> : "—"),
    },
    { id: "matched", header: "Matched by", sortValue: (r) => r.matchedBy ?? "", cell: (r) => r.matchedBy ?? "—" },
    {
      id: "status",
      header: "Status",
      sortValue: (r) => (r.needsReview ? 0 : r.invoice ? 2 : 1),
      cell: (r) =>
        r.needsReview ? <StatusBadge value="review" label="Review amount" /> : r.invoice ? <StatusBadge value="paid" label="Matched" /> : <StatusBadge value="pending" label="Unmatched" />,
    },
    ...(matchOptions
      ? [{ id: "match", header: "", cell: (r: PaymentRow) => <MatchPaymentButton paymentId={r.id} options={matchOptions} /> }]
      : []),
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      getRowHref={matchOptions ? undefined : (r) => (r.invoice ? `/invoices/${r.invoice.id}` : undefined)}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
    />
  );
}
