import type { ExpenseCategory, ExpenseKind } from "@prisma/client";
import { fromMinor, toMinor } from "@/lib/invoices/pure";

/** Expense labels and sums. Sums run in integer minor units per currency, never across currencies. */

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  software: "Software & subscriptions",
  utilities: "Utilities",
  rent: "Rent & office",
  internet: "Internet & phone",
  equipment: "Equipment & hardware",
  marketing: "Marketing",
  professional_services: "Professional services",
  travel: "Travel",
  other: "Other",
};

export const EXPENSE_KIND_LABELS: Record<ExpenseKind, string> = { opex: "Opex", capex: "Capex" };

/** What a new expense in this category usually is; the form preselects it. */
export function defaultKind(category: ExpenseCategory): ExpenseKind {
  return category === "equipment" ? "capex" : "opex";
}

export type ExpenseTotal = { currency: string; total: number; opex: number; capex: number; count: number };

export function expenseTotals(rows: { amount: number; currency: string; kind: ExpenseKind }[]): ExpenseTotal[] {
  const acc = new Map<string, { opex: number; capex: number; count: number }>();
  for (const r of rows) {
    const t = acc.get(r.currency) ?? { opex: 0, capex: 0, count: 0 };
    t[r.kind] += toMinor(r.amount, r.currency);
    t.count += 1;
    acc.set(r.currency, t);
  }
  return [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, t]) => ({
      currency,
      total: fromMinor(t.opex + t.capex, currency),
      opex: fromMinor(t.opex, currency),
      capex: fromMinor(t.capex, currency),
      count: t.count,
    }));
}
