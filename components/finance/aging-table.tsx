"use client";

import Link from "next/link";
import type { ClientAging } from "@/lib/finance/obligations";
import { DataTable, type Column } from "@/components/data-table";
import { MoneyText } from "@/components/money-text";

const cell = (v: number, late = false) =>
  v ? <MoneyText value={v} currency="IDR" className={late ? "text-destructive" : undefined} /> : <span className="text-muted-foreground">—</span>;

/**
 * Receivables aging per client (PRD Phase 2 "Finance"): what each client owes
 * by how late it is — the studio aging's buckets, per client, in IDR.
 */
export function AgingByClientTable({ rows }: { rows: ClientAging[] }) {
  const columns: Column<ClientAging>[] = [
    {
      id: "client",
      header: "Client",
      primary: true,
      sortValue: (r) => r.client,
      cell: (r) => (
        <Link href={`/clients/${r.clientId}?tab=invoices`} className="hover:underline">
          {r.client}
          {r.unconverted > 0 && <span className="text-muted-foreground"> · {r.unconverted} without a rate</span>}
        </Link>
      ),
    },
    { id: "not_due", header: "Not due", align: "right", sortValue: (r) => r.buckets.not_due, cell: (r) => cell(r.buckets.not_due) },
    { id: "late_1_30", header: "1–30 days late", align: "right", sortValue: (r) => r.buckets.late_1_30, cell: (r) => cell(r.buckets.late_1_30, true) },
    { id: "late_31_60", header: "31–60 days", align: "right", sortValue: (r) => r.buckets.late_31_60, cell: (r) => cell(r.buckets.late_31_60, true) },
    { id: "late_60_plus", header: "Over 60 days", align: "right", sortValue: (r) => r.buckets.late_60_plus, cell: (r) => cell(r.buckets.late_60_plus, true) },
    { id: "total", header: "Total owed", align: "right", sortValue: (r) => r.total, cell: (r) => <MoneyText value={r.total} currency="IDR" className="font-medium" /> },
  ];
  return <DataTable columns={columns} rows={rows} getRowId={(r) => r.clientId} emptyTitle="Nothing owed" emptyDescription="No client has an unpaid invoice." />;
}
