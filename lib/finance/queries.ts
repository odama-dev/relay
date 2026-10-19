import "server-only";
import { withRls } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { num, numOr0 } from "@/lib/money";
import { addDays, addMonths, isoDate, monthStart, parseIsoDate, todayIn, type IsoDate } from "@/lib/time/pure";
import { delta, estimateIdr, lastDayOfMonth, lastMonths, monthTarget, round2 } from "@/lib/clevel/pure";
import { agingSummary, forecastMonths, linearTrend } from "@/lib/finance/pure";

/** How many months past this one the forecast reaches. */
export const FORECAST_HORIZON = 3;
/** Past months on the chart, this month included. */
const HISTORY = 6;

export type ExpectedPayment = {
  id: string;
  invoiceId: string;
  invoice: string;
  client: string;
  label: string;
  due: IsoDate;
  amount: number;
  currency: string;
  idr: number | null;
  status: "pending" | "overdue" | "draft";
};

/**
 * Everything the Finance Overview shows (Finance, Sales, C-Level), read
 * under RLS. People costs are never read: Finance and Sales can't see them.
 * Revenue targets (C-Level only) and expenses (Finance, C-Level) come back
 * empty for whoever may not read them.
 */
export async function loadFinanceOverview(user: CurrentUser) {
  const today = todayIn(user.timezone);
  const thisMonth = monthStart(today);
  const lastDay = lastDayOfMonth(addMonths(thisMonth, FORECAST_HORIZON));
  const since = addMonths(thisMonth, -12);
  const showExpenses = perms.manageExpenses(user);

  const data = await withRls(user.id, async (tx) => ({
    payments: await tx.payment.findMany({
      where: { paidAt: { gte: parseIsoDate(addDays(since, -1)) }, invoiceId: { not: null } },
      select: { paidAt: true, settlementAmountIdr: true },
    }),
    requests: await tx.invoicePaymentRequest.findMany({
      where: { status: "pending", invoice: { status: { in: ["draft", "sent", "partially_paid", "overdue"] } } },
      select: {
        id: true,
        label: true,
        amount: true,
        dueDate: true,
        invoice: { select: { id: true, number: true, status: true, currency: true, billToName: true } },
      },
      orderBy: { dueDate: "asc" },
    }),
    projects: await tx.project.findMany({
      where: { status: "active", kind: "client", contractType: { in: ["retainer", "fixed"] } },
      select: {
        contractType: true,
        currency: true,
        endDate: true,
        contract: { select: { contractValue: true, retainerFeePerMonth: true } },
        invoices: {
          where: { status: { not: "void" } },
          select: { total: true, paymentRequests: { where: { status: { not: "void" } }, select: { dueDate: true } } },
        },
      },
    }),
    refRates: await tx.fxReferenceRate.findMany({ where: { effectiveFrom: { lte: parseIsoDate(today) } }, orderBy: { effectiveFrom: "desc" } }),
    lastFx: await tx.payment.findMany({ where: { fxRateToIdr: { not: null } }, orderBy: { paidAt: "desc" }, select: { currency: true, fxRateToIdr: true }, take: 200 }),
    targets: await tx.revenueTarget.findMany(),
    expenses: showExpenses
      ? await tx.expense.findMany({ where: { expenseDate: { gte: parseIsoDate(addMonths(thisMonth, -1)) } }, select: { expenseDate: true, amount: true, currency: true } })
      : [],
  }));

  // Currency → IDR: the reference rate, else the last payment's (as the C-Level dashboard).
  const rates = new Map<string, number>();
  for (const r of data.refRates) if (!rates.has(r.currency)) rates.set(r.currency, numOr0(r.rateToIdr));
  for (const p of data.lastFx) if (!rates.has(p.currency) && p.fxRateToIdr) rates.set(p.currency, numOr0(p.fxRateToIdr));
  const targets = data.targets.map((t) => ({ year: t.year, month: t.month, targetIdr: numOr0(t.targetIdr) }));
  const hasTargets = targets.length > 0;

  // Revenue received per month: matched payments, settled IDR, by the viewer's local day.
  const received = new Map<IsoDate, number>();
  for (const p of data.payments) {
    const m = monthStart(todayIn(user.timezone, p.paidAt));
    received.set(m, (received.get(m) ?? 0) + numOr0(p.settlementAmountIdr));
  }
  const revenueOf = (m: IsoDate) => round2(received.get(m) ?? 0);

  const requests = data.requests.map((r) => {
    const amount = numOr0(r.amount);
    return {
      id: r.id,
      invoiceId: r.invoice.id,
      invoice: r.invoice.number ?? "Draft",
      client: r.invoice.billToName,
      label: r.label,
      due: isoDate(r.dueDate),
      amount,
      currency: r.invoice.currency,
      idr: estimateIdr(amount, r.invoice.currency, rates),
      draft: r.invoice.status === "draft",
    };
  });

  const forecast = forecastMonths({
    today,
    horizon: FORECAST_HORIZON,
    requests: requests.map((r) => ({ due: r.due, idr: r.idr, draft: r.draft })),
    retainers: data.projects
      .filter((p) => p.contractType === "retainer")
      .map((p) => {
        const fee = num(p.contract?.retainerFeePerMonth);
        return {
          endDate: p.endDate ? isoDate(p.endDate) : null,
          feeIdr: fee === null ? null : estimateIdr(fee, p.currency, rates),
          billedMonths: [...new Set(p.invoices.flatMap((i) => i.paymentRequests.map((r) => monthStart(isoDate(r.dueDate)))))],
        };
      }),
    contracts: data.projects
      .filter((p) => p.contractType === "fixed")
      .map((p) => {
        const value = num(p.contract?.contractValue);
        const invoiced = p.invoices.reduce((s, i) => s + numOr0(i.total), 0);
        return {
          endDate: p.endDate ? isoDate(p.endDate) : null,
          remainingIdr: value === null ? null : estimateIdr(Math.max(0, value - invoiced), p.currency, rates),
        };
      }),
  });

  // Trend from the 12 full months before this one, carried through the forecast.
  const past12 = lastMonths(addMonths(thisMonth, -1), 12);
  const trend = linearTrend(past12.map(revenueOf), FORECAST_HORIZON + 1);

  const history = lastMonths(today, HISTORY);
  const chart = [
    ...history.map((m) => {
      const f = m === thisMonth ? forecast.months[0]! : null;
      return {
        month: m,
        actual: revenueOf(m),
        invoiced: f?.invoiced ?? 0,
        overdue: f?.overdue ?? 0,
        retainer: f?.retainer ?? 0,
        contract: f?.contract ?? 0,
        draft: f?.draft ?? 0,
        trend: m === thisMonth ? (trend?.[0] ?? null) : null,
        target: monthTarget(targets, m),
      };
    }),
    ...forecast.months.slice(1).map((f, i) => ({
      month: f.month,
      actual: 0,
      invoiced: f.invoiced,
      overdue: f.overdue,
      retainer: f.retainer,
      contract: f.contract,
      draft: f.draft,
      trend: trend?.[i + 1] ?? null,
      target: monthTarget(targets, f.month),
    })),
  ];

  const sent = requests.filter((r) => !r.draft);
  const outstanding = round2(sent.reduce((s, r) => s + (r.idr ?? 0), 0));
  const overdue = sent.filter((r) => r.due < today);
  // This month so far against last month up to the same day, so a running month compares like for like.
  const lastMonth = addMonths(thisMonth, -1);
  const sameDayLastMonth = `${lastMonth.slice(0, 8)}${today.slice(8)}`;
  const toDate = { now: { start: thisMonth, end: today }, before: { start: lastMonth, end: sameDayLastMonth } };
  const inRange = (d: IsoDate, w: { start: IsoDate; end: IsoDate }) => d >= w.start && d <= w.end;
  const paidDays = data.payments.map((p) => ({ day: todayIn(user.timezone, p.paidAt), idr: numOr0(p.settlementAmountIdr) }));
  const receivedIn = (w: { start: IsoDate; end: IsoDate }) => round2(paidDays.filter((p) => inRange(p.day, w)).reduce((s, p) => s + p.idr, 0));
  const expensesIn = (w: { start: IsoDate; end: IsoDate }) =>
    round2(
      data.expenses
        .filter((e) => inRange(isoDate(e.expenseDate), w))
        .reduce((s, e) => s + (estimateIdr(numOr0(e.amount), e.currency, rates) ?? 0), 0),
    );

  const expected: ExpectedPayment[] = requests
    .filter((r) => r.due <= addDays(today, 90))
    .map((r) => ({
      id: r.id,
      invoiceId: r.invoiceId,
      invoice: r.invoice,
      client: r.client,
      label: r.label,
      due: r.due,
      amount: r.amount,
      currency: r.currency,
      idr: r.idr,
      status: r.draft ? "draft" : r.due < today ? "overdue" : "pending",
    }));

  return {
    today,
    received: { value: receivedIn(toDate.now), change: delta(receivedIn(toDate.now), receivedIn(toDate.before)) },
    outstanding: { idr: outstanding, count: sent.length },
    overdue: { idr: round2(overdue.reduce((s, r) => s + (r.idr ?? 0), 0)), count: overdue.length },
    nextMonths: round2(forecast.months.slice(1).reduce((s, m) => s + m.total, 0)),
    expenses: showExpenses ? { value: expensesIn(toDate.now), change: delta(expensesIn(toDate.now), expensesIn(toDate.before)) } : null,
    forecast,
    trend,
    chart,
    hasTargets,
    aging: agingSummary(sent, today),
    expected,
    missingRate: [...new Set(requests.filter((r) => r.idr === null).map((r) => r.currency))],
    lastDay,
  };
}
