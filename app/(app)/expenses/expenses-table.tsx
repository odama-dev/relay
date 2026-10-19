"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ExpenseRow } from "@/lib/expenses/queries";
import type { ExpenseInput } from "@/lib/validation";
import { EXPENSE_CATEGORY_LABELS, EXPENSE_KIND_LABELS } from "@/lib/expenses/pure";
import { formatDateShort, formatMoney } from "@/lib/format";
import { DataTable, type Column } from "@/components/data-table";
import { MoneyText } from "@/components/money-text";
import { StatusBadge } from "@/components/status-badge";
import { RowActions } from "@/components/row-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Icon } from "@/components/icon";
import { ExpenseFormDialog } from "./expense-form-dialog";
import { deleteExpense } from "./actions";

export function ExpensesTable({ rows, today, currency, projects }: { rows: ExpenseRow[]; today: string; currency: ExpenseInput["currency"]; projects: { value: string; label: string }[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [deleting, setDeleting] = useState<ExpenseRow | null>(null);

  const columns: Column<ExpenseRow>[] = [
    { id: "date", header: "Date", sortValue: (r) => r.expenseDate, cell: (r) => <span className="tabular">{formatDateShort(r.expenseDate)}</span> },
    {
      id: "vendor",
      header: "Vendor",
      sortValue: (r) => r.vendor.toLowerCase(),
      cell: (r) => r.vendor,
    },
    { id: "project", header: "Project", primary: true, sortValue: (r) => r.project?.code ?? "", cell: (r) => <span className="tabular">{r.project?.code ?? "—"}</span> },
    {
      id: "description",
      header: "Description",
      cell: (r) => (
        <span className="block max-w-64 truncate" title={r.description ?? undefined}>
          {r.description || "—"}
        </span>
      ),
    },
    { id: "category", header: "Category", sortValue: (r) => r.category, cell: (r) => EXPENSE_CATEGORY_LABELS[r.category] },
    {
      id: "kind",
      header: "Type",
      sortValue: (r) => r.kind,
      cell: (r) => <StatusBadge value={r.kind === "capex" ? "sent" : "draft"} label={EXPENSE_KIND_LABELS[r.kind]} />,
    },
    { id: "amount", header: "Amount", align: "right", sortValue: (r) => r.amount, cell: (r) => <MoneyText value={r.amount} currency={r.currency} /> },
    {
      id: "receipt",
      header: "Receipt",
      cell: (r) =>
        r.receiptName ? (
          <a
            href={`/api/files/receipts/${r.id}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex max-w-36 items-center gap-1.5 hover:underline"
            title={r.receiptName}
          >
            <Icon name="file" size={14} />
            <span className="truncate">{r.receiptName}</span>
          </a>
        ) : (
          "—"
        ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (r) => (
        <RowActions
          label={`Actions for ${r.vendor} on ${formatDateShort(r.expenseDate)}`}
          actions={[
            { label: "Edit", icon: "edit", onSelect: () => setEditing(r) },
            { label: "Delete", icon: "delete", destructive: true, onSelect: () => setDeleting(r) },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        pageSize={50}
        emptyTitle="No expenses match"
        emptyDescription="Try another period or clear the filters."
      />
      <ExpenseFormDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        today={today}
        currency={currency}
        projects={projects}
        expense={
          editing
            ? {
                id: editing.id,
                receiptName: editing.receiptName,
                values: {
                  expenseDate: editing.expenseDate,
                  vendor: editing.vendor,
                  description: editing.description ?? "",
                  category: editing.category,
                  kind: editing.kind,
                  amount: editing.amount,
                  currency: editing.currency as ExpenseInput["currency"],
                  notes: editing.notes ?? "",
                  projectId: editing.project?.id ?? "",
                },
              }
            : undefined
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this expense?"
        description={deleting ? `${deleting.vendor} · ${formatMoney(deleting.amount, deleting.currency)} on ${formatDateShort(deleting.expenseDate)}. Its receipt is deleted too.` : undefined}
        confirmLabel="Delete expense"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteExpense(deleting.id);
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          toast.success("Expense deleted");
          router.refresh();
        }}
      />
    </>
  );
}
