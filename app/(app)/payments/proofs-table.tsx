"use client";

import { useState } from "react";
import Link from "next/link";
import { DataTable, type Column } from "@/components/data-table";
import { MoneyText } from "@/components/money-text";
import { Button } from "@/components/ui/button";
import { ProofDecisionDialog } from "@/components/invoice/proof-decision-dialog";
import { formatDateShort } from "@/lib/format";

export type ProofRow = {
  id: string;
  amount: number;
  currency: string;
  fxRate: number | null;
  paidOn: string;
  platform: string;
  invoice: { id: string; number: string | null; client: string };
  request: string | null;
  submittedBy: string | null;
  /** Waiting since (yyyy-mm-dd), for the 2-working-day target. */
  submittedOn: string;
  hasFile: boolean;
  /** You submitted it: someone else verifies. */
  own: boolean;
};

/** Phase 2 · M9 — payment proofs from Sales waiting for Finance, oldest first. */
export function ProofsTable({ rows, canDecide }: { rows: ProofRow[]; canDecide: boolean }) {
  const [deciding, setDeciding] = useState<{ row: ProofRow; verify: boolean } | null>(null);
  const columns: Column<ProofRow>[] = [
    { id: "submitted", header: "Submitted", sortValue: (r) => r.submittedOn, cell: (r) => <span className="tabular">{formatDateShort(r.submittedOn)}</span> },
    {
      id: "invoice",
      header: "Invoice",
      primary: true,
      sortValue: (r) => r.invoice.number ?? "",
      cell: (r) => (
        <Link href={`/invoices/${r.invoice.id}`} className="tabular hover:underline">
          {r.invoice.number ?? "Draft"}
        </Link>
      ),
    },
    { id: "client", header: "Client", sortValue: (r) => r.invoice.client, cell: (r) => r.invoice.client },
    { id: "request", header: "For", cell: (r) => r.request ?? "Whole invoice" },
    { id: "amount", header: "Amount", align: "right", sortValue: (r) => r.amount, cell: (r) => <MoneyText value={r.amount} currency={r.currency} /> },
    { id: "paidOn", header: "Paid on", sortValue: (r) => r.paidOn, cell: (r) => <span className="tabular">{formatDateShort(r.paidOn)}</span> },
    { id: "platform", header: "Via", sortValue: (r) => r.platform, cell: (r) => r.platform },
    { id: "by", header: "From", sortValue: (r) => r.submittedBy ?? "", cell: (r) => r.submittedBy ?? "—" },
    {
      id: "proof",
      header: "Proof",
      cell: (r) =>
        r.hasFile ? (
          <a href={`/api/files/payment-proofs/${r.id}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            Open
          </a>
        ) : (
          "—"
        ),
    },
    ...(canDecide
      ? [
          {
            id: "actions",
            header: "",
            align: "right" as const,
            cell: (r: ProofRow) =>
              r.own ? (
                <span className="text-muted-foreground text-caption">Yours — another person verifies</span>
              ) : (
                <span className="flex justify-end gap-2">
                  <Button size="sm" onClick={() => setDeciding({ row: r, verify: true })}>
                    Verify
                  </Button>
                  <Button size="sm" variant="tertiary" onClick={() => setDeciding({ row: r, verify: false })}>
                    Reject
                  </Button>
                </span>
              ),
          },
        ]
      : []),
  ];
  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        emptyTitle="Nothing to verify"
        emptyDescription="Proofs Sales uploads for transfers, Wise or PayPal payments land here."
      />
      {deciding && <ProofDecisionDialog proof={deciding.row} verify={deciding.verify} onClose={() => setDeciding(null)} />}
    </>
  );
}
