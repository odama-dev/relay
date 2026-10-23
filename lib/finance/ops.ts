import "server-only";
import type { ObligationKind } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { numOr0 } from "@/lib/money";
import { hasModule, perms } from "@/lib/roles";
import { idrRateMap } from "@/lib/fx";
import { estimateIdr, round2 } from "@/lib/clevel/pure";
import { addDays, isoDate, monthStart, parseIsoDate, todayIn, weekStart, type IsoDate } from "@/lib/time/pure";
import { agingByClient, obligationDates, OBLIGATION_KIND_LABELS } from "@/lib/finance/obligations";

/**
 * The Finance dashboard (PRD Phase 2 "Finance", M10): what has to be done
 * today. Trends and margins stay on the C-Level dashboard. Everything is
 * read under RLS and shown in IDR.
 */

const OPEN = ["sent", "partially_paid", "payment_submitted", "overdue"] as const;

/** Top strip: cash in this month, receivables due this week, proofs waiting, expenses this month. */
export async function loadFinanceStrip(user: CurrentUser) {
  const today = todayIn(user.timezone);
  const month = monthStart(today);
  const week = { from: weekStart(today), to: addDays(weekStart(today), 6) };
  const showExpenses = perms.manageExpenses(user);
  return asUser(user, async (tx) => {
    const [payments, due, proofs, expenses] = await Promise.all([
      // Same as Finance Overview "Received this month": matched payments, settled IDR.
      tx.payment.findMany({ where: { invoiceId: { not: null }, paidAt: { gte: parseIsoDate(addDays(month, -1)) } }, select: { paidAt: true, settlementAmountIdr: true } }),
      tx.invoicePaymentRequest.findMany({
        where: { status: "pending", dueDate: { gte: parseIsoDate(week.from), lte: parseIsoDate(week.to) }, invoice: { status: { in: [...OPEN] } } },
        select: { amount: true, invoice: { select: { currency: true } } },
      }),
      tx.paymentProof.findMany({ where: { status: "submitted" }, select: { submittedAt: true } }),
      showExpenses ? tx.expense.findMany({ where: { expenseDate: { gte: parseIsoDate(month), lte: parseIsoDate(today) } }, select: { amount: true, currency: true } }) : Promise.resolve(null),
    ]);
    const rates = await idrRateMap(tx, [...due.map((d) => d.invoice.currency), ...(expenses ?? []).map((e) => e.currency)], today);
    const sumIdr = (rows: { amount: number; currency: string }[]) => {
      let idr = 0;
      let missing = 0;
      for (const r of rows) {
        const v = estimateIdr(r.amount, r.currency, rates);
        if (v === null) missing++;
        else idr += v;
      }
      return { idr: round2(idr), missing };
    };
    const oldest = proofs.reduce<Date | null>((m, p) => (!m || p.submittedAt < m ? p.submittedAt : m), null);
    return {
      today,
      cashIn: round2(payments.filter((p) => monthStart(todayIn(user.timezone, p.paidAt)) === month).reduce((s, p) => s + numOr0(p.settlementAmountIdr), 0)),
      dueThisWeek: { ...sumIdr(due.map((d) => ({ amount: numOr0(d.amount), currency: d.invoice.currency }))), count: due.length, from: week.from, to: week.to },
      proofs: { count: proofs.length, oldestDays: oldest ? Math.floor((Date.now() - oldest.getTime()) / 86_400_000) : null },
      expenses: expenses ? sumIdr(expenses.map((e) => ({ amount: numOr0(e.amount), currency: e.currency }))) : null,
    };
  });
}

/** Receivables aging per client (0–30, 31–60, over 60 days late), in IDR. */
export async function loadAgingByClient(user: CurrentUser) {
  const today = todayIn(user.timezone);
  return asUser(user, async (tx) => {
    const requests = await tx.invoicePaymentRequest.findMany({
      where: { status: { in: ["pending", "expired"] }, invoice: { status: { in: [...OPEN] } } },
      select: { amount: true, dueDate: true, invoice: { select: { currency: true, client: { select: { id: true, name: true } } } } },
    });
    const rates = await idrRateMap(tx, requests.map((r) => r.invoice.currency), today);
    return agingByClient(
      requests.map((r) => ({
        clientId: r.invoice.client.id,
        client: r.invoice.client.name,
        due: isoDate(r.dueDate),
        idr: estimateIdr(numOr0(r.amount), r.invoice.currency, rates),
      })),
      today,
    );
  });
}

export type ObligationItem = {
  key: string;
  startDate: IsoDate;
  endDate: IsoDate;
  kind: ObligationKind | "invoice";
  title: string;
  /** Obligation id, for marking done; null for invoice due dates. */
  obligationId: string | null;
  done: boolean;
  amount: number | null;
  currency: string | null;
  href: string | null;
};

/**
 * Obligations calendar from `from` to `to`: every obligation occurrence the
 * viewer may see (with done / not done) and the due dates of unpaid invoice
 * requests (Finance and Studio Report only).
 */
export async function loadObligations(user: CurrentUser, from: IsoDate, to: IsoDate): Promise<ObligationItem[]> {
  const withInvoices = hasModule(user, "finance", "studio_report") || perms.viewFinanceOverview(user);
  return asUser(user, async (tx) => {
    const [obligations, requests] = await Promise.all([
      tx.obligation.findMany({
        where: { isActive: true },
        include: { completions: { where: { dueDate: { gte: parseIsoDate(from), lte: parseIsoDate(to) } }, select: { dueDate: true } } },
      }),
      withInvoices
        ? tx.invoicePaymentRequest.findMany({
            where: { status: { in: ["pending", "expired"] }, dueDate: { gte: parseIsoDate(from), lte: parseIsoDate(to) }, invoice: { status: { in: [...OPEN] } } },
            select: { id: true, label: true, amount: true, dueDate: true, invoice: { select: { id: true, number: true, currency: true, billToName: true } } },
          })
        : Promise.resolve([]),
    ]);
    const items: ObligationItem[] = [];
    for (const o of obligations) {
      const done = new Set(o.completions.map((c) => isoDate(c.dueDate)));
      for (const d of obligationDates({ recurrence: o.recurrence, dayOfMonth: o.dayOfMonth, month: o.month, onDate: o.onDate ? isoDate(o.onDate) : null }, from, to)) {
        items.push({
          key: `${o.id}:${d}`,
          startDate: d,
          endDate: d,
          kind: o.kind,
          title: o.title,
          obligationId: o.id,
          done: done.has(d),
          amount: o.amountEstimate === null ? null : numOr0(o.amountEstimate),
          currency: o.currency,
          href: null,
        });
      }
    }
    for (const r of requests) {
      const d = isoDate(r.dueDate);
      items.push({
        key: `req:${r.id}`,
        startDate: d,
        endDate: d,
        kind: "invoice",
        title: `${r.invoice.number ?? "Invoice"} · ${r.invoice.billToName}`,
        obligationId: null,
        done: false,
        amount: numOr0(r.amount),
        currency: r.invoice.currency,
        href: `/invoices/${r.invoice.id}`,
      });
    }
    return items.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
  });
}

/** Obligations as the manage dialog edits them. */
export async function listObligations(user: CurrentUser) {
  const rows = await asUser(user, (tx) => tx.obligation.findMany({ orderBy: [{ isActive: "desc" }, { kind: "asc" }, { dayOfMonth: "asc" }] }));
  return rows.map((o) => ({
    id: o.id,
    title: o.title,
    kind: o.kind,
    kindLabel: OBLIGATION_KIND_LABELS[o.kind],
    recurrence: o.recurrence,
    dayOfMonth: o.dayOfMonth,
    month: o.month,
    onDate: o.onDate ? isoDate(o.onDate) : null,
    amountEstimate: o.amountEstimate === null ? null : numOr0(o.amountEstimate),
    currency: o.currency,
    notes: o.notes,
    isActive: o.isActive,
  }));
}

export type ObligationRow = Awaited<ReturnType<typeof listObligations>>[number];

/** The month shown by the obligations calendar (`?omonth=yyyy-mm`), defaulting to this month. */
export function obligationMonth(raw: string | undefined, today: IsoDate): IsoDate {
  return raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? `${raw}-01` : monthStart(today);
}

