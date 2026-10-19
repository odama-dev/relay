import "server-only";
import type { ExpenseCategory, ExpenseKind, Prisma } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { numOr0 } from "@/lib/money";
import { isoDate, isIsoDate, parseIsoDate, type IsoDate } from "@/lib/time/pure";
import { CURRENCIES, EXPENSE_CATEGORIES, EXPENSE_KINDS } from "@/lib/validation";

export type ExpenseFilters = {
  q?: string;
  kind?: ExpenseKind;
  category?: ExpenseCategory;
  currency?: string;
  from?: IsoDate;
  to?: IsoDate;
};

export function parseExpenseFilters(sp: Record<string, string | string[] | undefined>): ExpenseFilters {
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const pick = <T extends string>(list: readonly T[], v?: string) => (list.includes(v as T) ? (v as T) : undefined);
  return {
    q: get("q")?.trim() || undefined,
    kind: pick(EXPENSE_KINDS, get("kind")),
    category: pick(EXPENSE_CATEGORIES, get("category")),
    currency: pick(CURRENCIES, get("currency")),
    from: isIsoDate(get("from")) ? get("from") : undefined,
    to: isIsoDate(get("to")) ? get("to") : undefined,
  };
}

export type ExpenseRow = {
  id: string;
  expenseDate: IsoDate;
  vendor: string;
  description: string | null;
  category: ExpenseCategory;
  kind: ExpenseKind;
  amount: number;
  currency: string;
  notes: string | null;
  receiptName: string | null;
  recordedBy: string | null;
  project: { id: string; code: string } | null;
};

/** Expenses the viewer may see (RLS: Finance and C-Level), newest first. */
export async function listExpenses(user: CurrentUser, f: ExpenseFilters): Promise<ExpenseRow[]> {
  const where: Prisma.ExpenseWhereInput = {
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.currency ? { currency: f.currency } : {}),
    ...(f.from || f.to ? { expenseDate: { ...(f.from ? { gte: parseIsoDate(f.from) } : {}), ...(f.to ? { lte: parseIsoDate(f.to) } : {}) } } : {}),
    ...(f.q
      ? {
          OR: [
            { vendor: { contains: f.q, mode: "insensitive" } },
            { description: { contains: f.q, mode: "insensitive" } },
            { notes: { contains: f.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const rows = await asUser(user, (tx) =>
    tx.expense.findMany({
      where,
      include: { creator: { select: { fullName: true } }, project: { select: { id: true, code: true } } },
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
      take: 1000,
    }),
  );
  return rows.map((e) => ({
    id: e.id,
    expenseDate: isoDate(e.expenseDate),
    vendor: e.vendor,
    description: e.description,
    category: e.category,
    kind: e.kind,
    amount: numOr0(e.amount),
    currency: e.currency,
    notes: e.notes,
    receiptName: e.receiptPath ? (e.receiptName ?? "Receipt") : null,
    recordedBy: e.creator?.fullName ?? null,
    project: e.project,
  }));
}

export type ProjectOption = { value: string; label: string };

/** Client and internal projects an expense can be tied to (Active, On hold, Completed). */
export async function expenseProjectOptions(user: CurrentUser): Promise<ProjectOption[]> {
  const rows = await asUser(user, (tx) =>
    tx.project.findMany({ where: { status: { not: "archived" } }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
  );
  return rows.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }));
}
