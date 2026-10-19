import "server-only";
import { cache } from "react";
import type { ContractType, OosStatus, ProjectStatus, UserRole } from "@prisma/client";
import { withRls, type Tx } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { num, numOr0 } from "@/lib/money";
import { getSettings, type AppSettings } from "@/lib/settings";
import { computeHealth } from "@/lib/health/queries";
import { normalizeThresholds, retainerMonths, snapshot, type HealthStatus, type OosMinutes } from "@/lib/health/pure";
import { addDays, addMonths, isIsoDate, isoDate, monthStart, monthsBetween, parseIsoDate, todayIn, type IsoDate } from "@/lib/time/pure";
import { onTimeRate } from "@/lib/dashboard/pure";
import {
  AGING_BUCKETS,
  PERIOD_KINDS,
  agingBucket,
  attentionReasons,
  availableHours,
  capacityStatus,
  concentration,
  daysBetween,
  delta,
  estimateIdr,
  lastDayOfMonth,
  lastMonths,
  margin,
  monthTarget,
  monthWindow,
  monthsOf,
  overlap,
  personCost,
  previousWindow,
  resolvePeriod,
  round2,
  targetStatus,
  utilizationPct,
  utilizationStatus,
  weightedTarget,
  windowTarget,
  workdaysIn,
  type CapacityOverride,
  type CapacityStatus,
  type Employment,
  type Period,
  type PeriodKind,
  type RevenueTargetRow,
  type UtilizationStatus,
  type Window,
} from "@/lib/clevel/pure";

/**
 * C-Level dashboard data (PRD/Clevel dashboard.md). Every read runs under RLS
 * as the viewer (`withRls`): cost tables only answer to HR and C-Level, so
 * margins can't be computed for anyone else. Project health reuses
 * `computeHealth` after the budgets were read under RLS (same as Project Health).
 *
 * Metrics run over the selected period up to today and are compared with
 * the same-length window before it (lib/clevel/pure.ts).
 */

export type ClevelContext = {
  user: CurrentUser;
  today: IsoDate;
  period: Period;
  prev: Window;
};

export function clevelContext(user: CurrentUser, sp: Record<string, string | string[] | undefined>): ClevelContext {
  const today = todayIn(user.timezone);
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const kind = (PERIOD_KINDS as readonly string[]).includes(get("period") ?? "") ? (get("period") as PeriodKind) : "month";
  const from = isIsoDate(get("from")) ? get("from") : undefined;
  const to = isIsoDate(get("to")) ? get("to") : undefined;
  const period = resolvePeriod(kind, today, { from, to });
  return { user, today, period, prev: previousWindow(period) };
}

/** Local calendar day of a timestamp (Asia/Jakarta by default, §2.2). */
const dayOf = (cc: ClevelContext, at: Date) => todayIn(cc.user.timezone, at);
const inWindow = (d: IsoDate, w: Window) => d >= w.start && d <= w.end;
/** A safe UTC lower bound for "since local day d". */
const since = (d: IsoDate) => parseIsoDate(addDays(d, -1));
const rls = <T>(cc: ClevelContext, fn: (tx: Tx) => Promise<T>) => withRls(cc.user.id, fn, { timeout: 30_000 });

// ---------------------------------------------------------------------------
// Shared inputs (one load per request)
// ---------------------------------------------------------------------------

type Person = {
  id: string;
  name: string;
  role: UserRole;
  active: boolean;
  employment: Employment;
  costs: { effectiveFrom: IsoDate; monthlyCostIdr: number }[];
  capacity: { effectiveFrom: IsoDate; weeklyHours: number }[];
  overrides: CapacityOverride[];
  target: number | null;
};

type Base = {
  settings: AppSettings;
  people: Person[];
  revenueTargets: RevenueTargetRow[];
  /** Currency → IDR rate for estimates: the reference rate, else the last payment's (§3.6). */
  rates: Map<string, number>;
};

const loadBase = cache(async (userId: string, timezone: string, today: IsoDate): Promise<Base> => {
  const [settings, data] = await Promise.all([
    getSettings(),
    withRls(userId, async (tx) => ({
      profiles: await tx.profile.findMany({ where: { status: { not: "invited" } }, select: { id: true, fullName: true, role: true, status: true, deactivatedAt: true } }),
      costs: await tx.personCost.findMany({ orderBy: { effectiveFrom: "asc" } }),
      capacity: await tx.personCapacity.findMany({ orderBy: { effectiveFrom: "asc" } }),
      overrides: await tx.capacityOverride.findMany(),
      roleTargets: await tx.utilizationTarget.findMany(),
      personTargets: await tx.utilizationOverride.findMany(),
      revenueTargets: await tx.revenueTarget.findMany(),
      refRates: await tx.fxReferenceRate.findMany({ where: { effectiveFrom: { lte: parseIsoDate(today) } }, orderBy: { effectiveFrom: "desc" } }),
      lastFx: await tx.payment.findMany({ where: { fxRateToIdr: { not: null } }, orderBy: { paidAt: "desc" }, select: { currency: true, fxRateToIdr: true }, take: 200 }),
    })),
  ]);
  const roleTarget = new Map(data.roleTargets.map((t) => [t.role, numOr0(t.targetPercent)]));
  const personTarget = new Map(data.personTargets.map((t) => [t.userId, numOr0(t.targetPercent)]));
  const people: Person[] = data.profiles.map((p) => ({
    id: p.id,
    name: p.fullName,
    role: p.role,
    active: p.status === "active",
    // Cost and capacity rows carry their own start dates; only leaving ends a person's time.
    employment: { activeFrom: "1900-01-01", activeTo: p.deactivatedAt ? todayIn(timezone, p.deactivatedAt) : null },
    costs: data.costs.filter((c) => c.userId === p.id).map((c) => ({ effectiveFrom: isoDate(c.effectiveFrom), monthlyCostIdr: numOr0(c.monthlyCostIdr) })),
    capacity: data.capacity.filter((c) => c.userId === p.id).map((c) => ({ effectiveFrom: isoDate(c.effectiveFrom), weeklyHours: numOr0(c.weeklyHours) })),
    overrides: data.overrides
      .filter((o) => o.userId === p.id)
      .map((o) => ({ start: isoDate(o.periodStart), end: isoDate(o.periodEnd), availableHours: numOr0(o.availableHours) })),
    target: p.role === "c_level" ? null : (personTarget.get(p.id) ?? roleTarget.get(p.role) ?? 0),
  }));
  const rates = new Map<string, number>();
  for (const r of data.refRates) if (!rates.has(r.currency)) rates.set(r.currency, numOr0(r.rateToIdr));
  for (const p of data.lastFx) if (!rates.has(p.currency) && p.fxRateToIdr) rates.set(p.currency, numOr0(p.fxRateToIdr));
  return {
    settings,
    people,
    revenueTargets: data.revenueTargets.map((t) => ({ year: t.year, month: t.month, targetIdr: numOr0(t.targetIdr) })),
    rates,
  };
});

const base = (cc: ClevelContext) => loadBase(cc.user.id, cc.user.timezone, cc.today);

/** Cost of one hour of a person in a month: monthly cost ÷ available hours that month (§3.1). Null without a cost. */
function hourlyCostFn(b: Base) {
  const memo = new Map<string, number | null>();
  return (person: Person | undefined, month: IsoDate): number | null => {
    if (!person) return null;
    const key = `${person.id}:${month}`;
    if (memo.has(key)) return memo.get(key)!;
    const w = { start: month, end: lastDayOfMonth(month) };
    const cost = personCost(person.costs, person.employment, w);
    // No capacity row (e.g. C-Level, who isn't in utilization): a standard 8-hour workday.
    const hours =
      availableHours(person.capacity, person.overrides, person.employment, w, b.settings.workdays) ??
      workdaysIn(w, b.settings.workdays).length * 8;
    const value = cost !== null && hours ? cost / hours : null;
    memo.set(key, value);
    return value;
  };
}

// ---------------------------------------------------------------------------
// Money in and out (shared by §4 and §5)
// ---------------------------------------------------------------------------

type Money = {
  /** Matched payments: local day, IDR received, fee in IDR, client & project. */
  payments: { day: IsoDate; idr: number; feeIdr: number; matched: boolean; clientId: string | null; projectId: string | null }[];
  /** Opex expenses in IDR (estimated for foreign currencies; null when no rate). */
  expenses: { day: IsoDate; idr: number | null; kind: "opex" | "capex"; projectId: string | null; currency: string }[];
  open: { id: string; amount: number; currency: string; idr: number | null; due: IsoDate; clientId: string; projectId: string; invoiceId: string }[];
  /** Requests due in the last 6 months that were late (paid after due, or still unpaid past due). */
  lateHistory: { clientId: string; daysLate: number }[];
  clients: Map<string, string>;
};

const loadMoney = cache(async (userId: string, timezone: string, today: IsoDate, b: Base): Promise<Money> => {
  const dayIn = (at: Date) => todayIn(timezone, at);
  const sixMonths = addMonths(monthStart(today), -5);
  const data = await withRls(userId, async (tx) => ({
    payments: await tx.payment.findMany({
      select: {
        paidAt: true,
        settlementAmountIdr: true,
        feeAmount: true,
        currency: true,
        fxRateToIdr: true,
        invoiceId: true,
        invoice: { select: { clientId: true, projectId: true } },
      },
    }),
    // All of them: the overview's "All time" view reaches back to the first one.
    expenses: await tx.expense.findMany({ select: { expenseDate: true, amount: true, currency: true, kind: true, projectId: true } }),
    open: await tx.invoicePaymentRequest.findMany({
      where: { status: "pending", invoice: { status: { in: ["sent", "partially_paid", "overdue"] } } },
      select: { id: true, amount: true, dueDate: true, invoice: { select: { id: true, currency: true, clientId: true, projectId: true } } },
    }),
    lateHistory: await tx.invoicePaymentRequest.findMany({
      where: { dueDate: { gte: parseIsoDate(sixMonths), lte: parseIsoDate(today) }, status: { in: ["paid", "pending"] }, invoice: { status: { notIn: ["draft", "void"] } } },
      select: { dueDate: true, paidAt: true, status: true, invoice: { select: { clientId: true } } },
    }),
    clients: await tx.client.findMany({ select: { id: true, name: true } }),
  }));
  return {
    payments: data.payments.map((p) => {
      const fee = numOr0(p.feeAmount);
      const rate = p.currency === "IDR" ? 1 : (num(p.fxRateToIdr) ?? b.rates.get(p.currency) ?? 0);
      return {
        day: dayIn(p.paidAt),
        idr: numOr0(p.settlementAmountIdr),
        feeIdr: round2(fee * rate),
        matched: Boolean(p.invoiceId),
        clientId: p.invoice?.clientId ?? null,
        projectId: p.invoice?.projectId ?? null,
      };
    }),
    expenses: data.expenses.map((e) => ({
      day: isoDate(e.expenseDate),
      idr: estimateIdr(numOr0(e.amount), e.currency, b.rates),
      kind: e.kind,
      projectId: e.projectId,
      currency: e.currency,
    })),
    open: data.open.map((r) => ({
      id: r.id,
      amount: numOr0(r.amount),
      currency: r.invoice.currency,
      idr: estimateIdr(numOr0(r.amount), r.invoice.currency, b.rates),
      due: isoDate(r.dueDate),
      clientId: r.invoice.clientId,
      projectId: r.invoice.projectId,
      invoiceId: r.invoice.id,
    })),
    lateHistory: data.lateHistory
      .map((r) => {
        const due = isoDate(r.dueDate);
        const end = r.status === "paid" && r.paidAt ? dayIn(r.paidAt) : today;
        return { clientId: r.invoice.clientId, daysLate: daysBetween(due, end) };
      })
      .filter((r) => r.daysLate > 0),
    clients: new Map(data.clients.map((c) => [c.id, c.name])),
  };
});

const money = async (cc: ClevelContext) => {
  const b = await base(cc);
  return loadMoney(cc.user.id, cc.user.timezone, cc.today, b);
};

function revenueIn(m: Money, w: Window) {
  return round2(m.payments.filter((p) => p.matched && inWindow(p.day, w)).reduce((s, p) => s + p.idr, 0));
}

function costsIn(b: Base, m: Money, w: Window) {
  let people = 0;
  for (const p of b.people) people += personCost(p.costs, p.employment, w) ?? 0;
  const expenses = m.expenses.filter((e) => e.kind === "opex" && inWindow(e.day, w));
  const opex = expenses.reduce((s, e) => s + (e.idr ?? 0), 0) + m.payments.filter((p) => inWindow(p.day, w)).reduce((s, p) => s + p.feeIdr, 0);
  return { people: round2(people), opex: round2(opex) };
}

// ---------------------------------------------------------------------------
// §8 Data completeness
// ---------------------------------------------------------------------------

export type DataWarning = { id: string; label: string; detail?: string; href: string; count: number };

export async function loadWarnings(cc: ClevelContext): Promise<DataWarning[]> {
  const b = await base(cc);
  const m = await money(cc);
  const { retainers, openWithoutEstimate } = await rls(cc, async (tx) => ({
    retainers: await tx.project.findMany({
      where: { status: "active", contractType: "retainer" },
      select: { id: true, code: true, contract: { select: { retainerFeePerMonth: true } } },
    }),
    openWithoutEstimate: await tx.task.count({ where: { status: { not: "done" }, estimateHours: null, section: { archivedAt: null }, project: { status: { in: ["active", "on_hold"] } } } }),
  }));
  const active = b.people.filter((p) => p.active);
  const noCost = active.filter((p) => !p.costs.some((c) => c.effectiveFrom <= cc.period.end));
  const noCapacity = active.filter((p) => p.role !== "c_level" && !p.capacity.some((c) => c.effectiveFrom <= cc.period.end));
  const monthsWithout = monthsOf(cc.period).filter((mo) => !m.expenses.some((e) => e.day >= mo && e.day <= lastDayOfMonth(mo)));
  const noFee = retainers.filter((r) => !r.contract?.retainerFeePerMonth);
  const unmatched = m.payments.filter((p) => !p.matched).length;
  const names = (list: { name: string }[]) => list.slice(0, 6).map((p) => p.name).join(", ") + (list.length > 6 ? ` +${list.length - 6}` : "");
  const out: DataWarning[] = [];
  if (noCost.length) out.push({ id: "cost", label: "People without a monthly cost", detail: names(noCost), href: "/business?tab=costs", count: noCost.length });
  if (noCapacity.length) out.push({ id: "capacity", label: "People without capacity", detail: names(noCapacity), href: "/business?tab=capacity", count: noCapacity.length });
  if (monthsWithout.length)
    out.push({
      id: "opex",
      label: "Months without operating expenses",
      detail: monthsWithout.map((mo) => new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(parseIsoDate(mo))).join(", "),
      href: "/expenses",
      count: monthsWithout.length,
    });
  if (noFee.length) out.push({ id: "retainer", label: "Active retainers without a monthly fee", detail: noFee.map((r) => r.code).join(", "), href: noFee.length === 1 ? `/projects/${noFee[0]!.id}` : "/projects", count: noFee.length });
  if (unmatched) out.push({ id: "unmatched", label: "Payments not matched to an invoice", href: "/payments?tab=unmatched", count: unmatched });
  if (openWithoutEstimate) out.push({ id: "estimate", label: "Open tasks without an estimate", href: "/projects", count: openWithoutEstimate });
  return out;
}

// ---------------------------------------------------------------------------
// §4 Cashflow, financial & forecast
// ---------------------------------------------------------------------------

export type Kpi = { value: number; previous: number; change: number; changePct: number | null; target: number | null; targetPct: number | null; status: "good" | "watch" | "bad" | null };

function kpi(value: number, previous: number, target: number | null, b: Base): Kpi {
  const d = delta(value, previous);
  const t = targetStatus(value, target, b.settings.clevel_dashboard_thresholds);
  return { value, previous, change: d.change, changePct: d.pct, target, targetPct: t?.pct ?? null, status: t?.status ?? null };
}

export async function loadFinance(cc: ClevelContext) {
  const b = await base(cc);
  const m = await money(cc);
  const econ = await projectEconomics(cc);

  // 4.1 Revenue
  const revenue = kpi(revenueIn(m, cc.period), revenueIn(m, cc.prev), windowTarget(b.revenueTargets, cc.period), b);
  // Month by month from the first payment or expense (at least the last 12
  // months), so the overview can show 3, 6, 12 months or all time.
  const twelve = lastMonths(cc.today, 12)[0]!;
  const first = [...m.payments.filter((p) => p.matched).map((p) => p.day), ...m.expenses.map((e) => e.day)].sort()[0];
  const months = monthsOf({ start: first && first < twelve ? monthStart(first) : twelve, end: cc.today });
  const trend = months.map((mo) => {
    const w = monthWindow(mo, cc.today);
    const rev = revenueIn(m, w);
    const c = costsIn(b, m, w);
    const incomplete =
      b.people.some((p) => p.active && !p.costs.some((x) => x.effectiveFrom <= w.end)) || !m.expenses.some((e) => e.day >= mo && e.day <= lastDayOfMonth(mo));
    return { month: mo, revenue: rev, target: monthTarget(b.revenueTargets, mo), opex: c.opex, costs: round2(c.people + c.opex), margin: round2(rev - c.people - c.opex), incomplete };
  });

  // 4.2 Receivables
  const byCurrency = new Map<string, number>();
  for (const r of m.open) byCurrency.set(r.currency, round2((byCurrency.get(r.currency) ?? 0) + r.amount));
  const estimated = m.open.reduce((s, r) => s + (r.idr ?? 0), 0);
  const missingRate = [...new Set(m.open.filter((r) => r.idr === null).map((r) => r.currency))];
  const aging = AGING_BUCKETS.map((bucket) => {
    const rows = m.open.filter((r) => agingBucket(r.due, cc.today) === bucket);
    return { bucket, count: rows.length, idr: round2(rows.reduce((s, r) => s + (r.idr ?? 0), 0)) };
  });
  const lateBy = new Map<string, number[]>();
  for (const r of m.lateHistory) lateBy.set(r.clientId, [...(lateBy.get(r.clientId) ?? []), r.daysLate]);
  const lateClients = [...lateBy]
    .map(([id, days]) => ({ id, name: m.clients.get(id) ?? "—", avgDaysLate: Math.round(days.reduce((s, d) => s + d, 0) / days.length), count: days.length }))
    .sort((a, b2) => b2.avgDaysLate - a.avgDaysLate)
    .slice(0, 5);

  // 4.3 Costs & margin
  const cur = costsIn(b, m, cc.period);
  const prev = costsIn(b, m, cc.prev);
  const curMargin = margin(revenue.value, cur.people + cur.opex);
  const prevMargin = margin(revenue.previous, prev.people + prev.opex);
  const costIncomplete = b.people.some((p) => p.active && !p.costs.some((c) => c.effectiveFrom <= cc.period.end)) || monthsOf(cc.period).some((mo) => !m.expenses.some((e) => e.day >= mo && e.day <= lastDayOfMonth(mo)));

  // 4.4 Per client
  const revByClient = new Map<string, number>();
  for (const p of m.payments) if (p.matched && p.clientId && inWindow(p.day, cc.period)) revByClient.set(p.clientId, (revByClient.get(p.clientId) ?? 0) + p.idr);
  const marginByClient = new Map<string, { value: number; known: boolean }>();
  for (const p of econ.rows) {
    if (!p.clientId) continue;
    const c = marginByClient.get(p.clientId) ?? { value: 0, known: true };
    c.value += p.period.margin;
    c.known &&= p.costKnown;
    marginByClient.set(p.clientId, c);
  }
  const receivableByClient = new Map<string, number>();
  for (const r of m.open) receivableByClient.set(r.clientId, (receivableByClient.get(r.clientId) ?? 0) + (r.idr ?? 0));
  const conc = concentration([...revByClient.values()]);
  const clients = [...new Set([...revByClient.keys(), ...marginByClient.keys()])]
    .map((id) => {
      const rev = round2(revByClient.get(id) ?? 0);
      const mg = marginByClient.get(id);
      return {
        id,
        name: m.clients.get(id) ?? "—",
        revenue: rev,
        margin: mg ? round2(mg.value) : null,
        marginPct: mg && rev > 0 ? round2((mg.value / rev) * 100) : null,
        marginKnown: mg?.known ?? false,
        receivable: round2(receivableByClient.get(id) ?? 0),
      };
    })
    .filter((c) => c.revenue > 0 || c.receivable > 0)
    .sort((a, b2) => b2.revenue - a.revenue)
    .slice(0, 10);

  // 4.5 Forecast — M+1…M+3
  const forecast = await forecastMonths(cc, b, m);

  return {
    revenue,
    trend,
    receivables: { byCurrency: [...byCurrency].map(([currency, amount]) => ({ currency, amount })), estimatedIdr: round2(estimated), missingRate, aging, lateClients, count: m.open.length },
    costs: {
      people: cur.people,
      opex: cur.opex,
      previous: { people: prev.people, opex: prev.opex },
      margin: curMargin,
      previousMargin: prevMargin,
      marginChange: delta(curMargin.value, prevMargin.value),
      incomplete: costIncomplete,
      capexExcluded: round2(m.expenses.filter((e) => e.kind === "capex" && inWindow(e.day, cc.period)).reduce((s, e) => s + (e.idr ?? 0), 0)),
    },
    clients,
    concentration: { ...conc, warn: conc.top1 !== null && conc.top1 > b.settings.clevel_dashboard_thresholds.concentration, threshold: b.settings.clevel_dashboard_thresholds.concentration },
    forecast,
  };
}

async function forecastMonths(cc: ClevelContext, b: Base, m: Money) {
  const months = [1, 2, 3].map((n) => addMonths(monthStart(cc.today), n));
  const retainers = await rls(cc, (tx) =>
    tx.project.findMany({
      where: { status: "active", contractType: "retainer" },
      select: {
        id: true,
        currency: true,
        endDate: true,
        contract: { select: { retainerFeePerMonth: true } },
        invoices: { where: { status: { not: "void" } }, select: { paymentRequests: { where: { status: { not: "void" } }, select: { dueDate: true } } } },
      },
    }),
  );
  return months.map((mo) => {
    const end = lastDayOfMonth(mo);
    const due = m.open.filter((r) => r.due >= mo && r.due <= end);
    const scheduled = round2(due.reduce((s, r) => s + (r.idr ?? 0), 0));
    let retainer = 0;
    let retainerMissingFee = 0;
    for (const p of retainers) {
      if (p.endDate && isoDate(p.endDate) < mo) continue;
      // Already billed for this month (a request due in it) → counted under "scheduled".
      const billed = p.invoices.some((i) => i.paymentRequests.some((r) => isoDate(r.dueDate) >= mo && isoDate(r.dueDate) <= end));
      if (billed) continue;
      const fee = num(p.contract?.retainerFeePerMonth);
      if (fee === null) {
        retainerMissingFee += 1;
        continue;
      }
      retainer += estimateIdr(fee, p.currency, b.rates) ?? 0;
    }
    retainer = round2(retainer);
    return { month: mo, scheduled, retainer, retainerMissingFee, pipeline: null as number | null, total: round2(scheduled + retainer), target: monthTarget(b.revenueTargets, mo) };
  });
}

// ---------------------------------------------------------------------------
// §5.4 Project economics (shared with §4.4)
// ---------------------------------------------------------------------------

export type ProjectEconomics = {
  id: string;
  code: string;
  name: string;
  clientId: string | null;
  client: string;
  endDate: IsoDate | null;
  members: { id: string; name: string; avatarUrl: string | null }[];
  contractType: ContractType | null;
  status: ProjectStatus;
  completedInPeriod: boolean;
  /** In the selected period. */
  period: { revenue: number; peopleCost: number; directCost: number; cost: number; margin: number; marginPct: number | null };
  /** Lifetime to date. */
  lifetime: { revenue: number; cost: number; hours: number; marginPct: number | null };
  effectiveRate: number | null;
  oosApprovedHours: number;
  oosValue: number | null;
  projectedMargin: number | null;
  /** Every hour on the project had a cost per hour. */
  costKnown: boolean;
};

type EntryRow = { project_id: string; user_id: string; day: Date; oos_status: OosStatus; minutes: number };

const loadEconomics = cache(async (userId: string, timezone: string, today: IsoDate, periodStart: IsoDate, periodEnd: IsoDate, b: Base, m: Money): Promise<{ rows: ProjectEconomics[] }> => {
  const w = { start: periodStart, end: periodEnd };
  const data = await withRls(userId, async (tx) => ({
    projects: await tx.project.findMany({
      where: { kind: "client", status: { not: "archived" } },
      select: {
        id: true,
        code: true,
        name: true,
        clientId: true,
        contractType: true,
        currency: true,
        status: true,
        startDate: true,
        endDate: true,
        updatedAt: true,
        client: { select: { name: true } },
        contract: { select: { contractValue: true, retainerFeePerMonth: true } },
        members: { select: { user: { select: { id: true, fullName: true, avatarUrl: true, status: true } } } },
      },
    }),
    entries: await tx.$queryRaw<EntryRow[]>`
      SELECT e.project_id::text, e.user_id::text, e.entry_date AS day, e.oos_status, SUM(e.minutes)::int AS minutes
      FROM time_entries e JOIN projects p ON p.id = e.project_id
      WHERE p.kind = 'client'
      GROUP BY 1, 2, 3, 4`,
    openEstimates: await tx.task.groupBy({ by: ["projectId"], where: { status: { not: "done" }, section: { archivedAt: null } }, _sum: { estimateHours: true } }),
  }));
  const hourly = hourlyCostFn(b);
  const personBy = new Map(b.people.map((p) => [p.id, p]));
  const remainingBy = new Map(data.openEstimates.map((r) => [r.projectId, numOr0(r._sum.estimateHours)]));

  const rows = data.projects.map((p): ProjectEconomics => {
    const entries = data.entries.filter((e) => e.project_id === p.id);
    let cost = 0;
    let periodCost = 0;
    let hours = 0;
    let costKnown = true;
    let oosApproved = 0;
    const people = new Set<string>();
    for (const e of entries) {
      const day = isoDate(e.day);
      const h = e.minutes / 60;
      const rate = hourly(personBy.get(e.user_id), monthStart(day));
      if (rate === null) costKnown = false;
      cost += h * (rate ?? 0);
      if (inWindow(day, w)) periodCost += h * (rate ?? 0);
      hours += h;
      people.add(e.user_id);
      if (e.oos_status === "approved") oosApproved += h;
    }
    const payments = m.payments.filter((x) => x.matched && x.projectId === p.id);
    const revenueAll = payments.reduce((s, x) => s + x.idr, 0);
    const revenuePeriod = payments.filter((x) => inWindow(x.day, w)).reduce((s, x) => s + x.idr, 0);
    const direct = m.expenses.filter((x) => x.projectId === p.id);
    const directAll = direct.reduce((s, x) => s + (x.idr ?? 0), 0);
    const directPeriod = direct.filter((x) => inWindow(x.day, w)).reduce((s, x) => s + (x.idr ?? 0), 0);

    // Rate efektif (§5.4): contract value (fixed), retainer fees so far (retainer), revenue (T&M) ÷ hours, in IDR.
    const contractValue = num(p.contract?.contractValue);
    const fee = num(p.contract?.retainerFeePerMonth);
    const start = isoDate(p.startDate);
    const end = p.endDate ? isoDate(p.endDate) : null;
    const monthsRun = monthsBetween(start, end && end < today ? end : today).length;
    const earned =
      p.contractType === "fixed" ? (contractValue !== null ? estimateIdr(contractValue, p.currency, b.rates) : null)
      : p.contractType === "retainer" ? (fee !== null ? estimateIdr(fee * monthsRun, p.currency, b.rates) : null)
      : revenueAll;
    const effectiveRate = earned !== null && hours > 0 ? round2(earned / hours) : null;

    // Margin proyeksi: contract value − cost so far − open task estimates × the team's average cost per hour.
    const avgRate = hours > 0 && costKnown ? cost / hours : null;
    const totalValue =
      p.contractType === "fixed" ? (contractValue !== null ? estimateIdr(contractValue, p.currency, b.rates) : null)
      : p.contractType === "retainer" && end && fee !== null ? estimateIdr(fee * monthsBetween(start, end).length, p.currency, b.rates)
      : null;
    const projectedMargin = totalValue !== null && avgRate !== null ? round2(totalValue - cost - directAll - (remainingBy.get(p.id) ?? 0) * avgRate) : null;

    const pm = margin(revenuePeriod, periodCost + directPeriod);
    const lifetime = margin(revenueAll, cost + directAll);
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      clientId: p.clientId,
      client: p.client?.name ?? "—",
      contractType: p.contractType,
      endDate: end,
      members: p.members.filter((x) => x.user.status !== "deactivated").map((x) => ({ id: x.user.id, name: x.user.fullName, avatarUrl: x.user.avatarUrl })),
      status: p.status,
      completedInPeriod: p.status === "completed" && inWindow(todayIn(timezone, p.updatedAt), w),
      period: { revenue: round2(revenuePeriod), peopleCost: round2(periodCost), directCost: round2(directPeriod), cost: round2(periodCost + directPeriod), margin: pm.value, marginPct: pm.pct },
      lifetime: { revenue: round2(revenueAll), cost: round2(cost + directAll), hours: round2(hours), marginPct: costKnown ? lifetime.pct : null },
      effectiveRate,
      oosApprovedHours: round2(oosApproved),
      oosValue: effectiveRate !== null ? round2(oosApproved * effectiveRate) : null,
      projectedMargin,
      costKnown,
    };
  });
  return { rows };
});

const projectEconomics = async (cc: ClevelContext) => {
  const [b, m] = await Promise.all([base(cc), money(cc)]);
  return loadEconomics(cc.user.id, cc.user.timezone, cc.today, cc.period.start, cc.period.end, b, m);
};

// ---------------------------------------------------------------------------
// §5 Project status
// ---------------------------------------------------------------------------

type MonthMinutes = Map<IsoDate, OosMinutes>;

export async function loadProjects(cc: ClevelContext) {
  const b = await base(cc);
  const m = await money(cc);
  const econ = await projectEconomics(cc);
  const sixMonths = lastMonths(cc.today, 6);

  const data = await rls(cc, async (tx) => ({
    projects: await tx.project.findMany({
      where: { status: { not: "archived" } },
      select: { id: true, kind: true, contractType: true, status: true, startDate: true, endDate: true, updatedAt: true, budget: true },
    }),
    frozen: await tx.retainerPeriod.findMany(),
    monthly: await tx.$queryRaw<{ project_id: string; month: Date; oos_status: OosStatus; minutes: number }[]>`
      SELECT project_id::text, date_trunc('month', entry_date)::date AS month, oos_status, SUM(minutes)::int AS minutes
      FROM time_entries WHERE project_id IS NOT NULL GROUP BY 1, 2, 3`,
    completed: await tx.task.findMany({
      where: { completedAt: { gte: since([sixMonths[0]!, cc.prev.start].sort()[0]!) }, status: "done" },
      select: { dueDate: true, completedAt: true },
    }),
    overdue: await tx.task.findMany({
      where: { status: { not: "done" }, dueDate: { lt: parseIsoDate(cc.today) }, section: { archivedAt: null }, project: { status: { in: ["active", "on_hold"] } } },
      select: { projectId: true, owner: { select: { role: true } } },
    }),
  }));

  // 5.1 Portfolio
  const active = data.projects.filter((p) => p.status === "active");
  const portfolio = {
    active: active.length,
    onHold: data.projects.filter((p) => p.status === "on_hold").length,
    completed: data.projects.filter((p) => p.status === "completed" && inWindow(dayOf(cc, p.updatedAt), cc.period)).length,
    started: data.projects.filter((p) => inWindow(isoDate(p.startDate), cc.period)).length,
    byType: (["retainer", "fixed", "time_and_material"] as const).map((t) => ({ type: t, count: active.filter((p) => p.kind === "client" && p.contractType === t).length })),
    internal: active.filter((p) => p.kind === "internal").length,
  };

  // 5.2 Health — now, and over budget per month (usage up to each month's end).
  const health = await computeHealth(active.filter((p) => p.budget), cc.today);
  const healthCounts = (["on_track", "warning", "over_budget"] as const).map((s) => ({ status: s, count: active.filter((p) => health.get(p.id)?.current.status === s).length }));
  const byProject = new Map<string, MonthMinutes>();
  for (const r of data.monthly) {
    const mm = byProject.get(r.project_id) ?? new Map();
    const key = isoDate(r.month);
    const v = mm.get(key) ?? { inScope: 0, pending: 0, approved: 0 };
    if (r.oos_status === "pending") v.pending += r.minutes;
    else if (r.oos_status === "approved") v.approved += r.minutes;
    else v.inScope += r.minutes;
    mm.set(key, v);
    byProject.set(r.project_id, mm);
  }
  const overBudgetTrend = sixMonths.map((mo) => {
    const end = lastDayOfMonth(mo);
    let count = 0;
    for (const p of data.projects) {
      if (!p.budget || isoDate(p.startDate) > end) continue;
      if (p.endDate && isoDate(p.endDate) < mo) continue;
      if (p.status === "completed" && dayOf(cc, p.updatedAt) < mo) continue;
      if (healthAt(p, byProject.get(p.id) ?? new Map(), data.frozen, mo) === "over_budget") count += 1;
    }
    return { month: mo, count };
  });

  // 5.3 Delivery
  const done = data.completed.map((t) => ({ dueDate: t.dueDate ? isoDate(t.dueDate) : null, completedOn: dayOf(cc, t.completedAt!) }));
  const onTime = (w: Window) => onTimeRate(done.filter((t) => inWindow(t.completedOn, w)));
  const division = new Map<string, number>();
  for (const t of data.overdue) {
    const key = t.owner?.role ?? "no_owner";
    division.set(key, (division.get(key) ?? 0) + 1);
  }
  const delivery = {
    onTimePct: onTime(cc.period),
    previousPct: onTime(cc.prev),
    overdue: data.overdue.length,
    byDivision: [...division].map(([role, count]) => ({ role: role as UserRole | "no_owner", count })).sort((a, b2) => b2.count - a.count),
    trend: sixMonths.map((mo) => ({ month: mo, pct: onTime(monthWindow(mo, cc.today)) })),
  };

  // 5.4 Margin table — active, plus completed in the period.
  const marginRows = econ.rows.filter((r) => r.status === "active" || r.completedInPeriod);

  // 5.5 Attention
  const rules = b.settings.project_attention_rules;
  const overdueBy = new Map<string, number>();
  for (const t of data.overdue) overdueBy.set(t.projectId, (overdueBy.get(t.projectId) ?? 0) + 1);
  const lateBy = new Map<string, number>();
  for (const r of m.open) {
    const late = daysBetween(r.due, cc.today);
    if (late > 0) lateBy.set(r.projectId, Math.max(lateBy.get(r.projectId) ?? 0, late));
  }
  const econBy = new Map(econ.rows.map((r) => [r.id, r]));
  const attention = await rls(cc, (tx) =>
    tx.project.findMany({ where: { status: "active" }, select: { id: true, code: true, name: true, client: { select: { name: true } } } }),
  ).then((list) =>
    list
      .map((p) => {
        const e = econBy.get(p.id);
        const reasons = attentionReasons(
          {
            budgetPct: health.get(p.id)?.current.pct ?? null,
            overdueTasks: overdueBy.get(p.id) ?? 0,
            maxDaysLate: lateBy.get(p.id) ?? 0,
            marginPct: e && e.costKnown && e.lifetime.revenue > 0 ? e.lifetime.marginPct : null,
          },
          rules,
        );
        return { id: p.id, code: p.code, name: p.name, client: p.client?.name ?? "Internal", reasons };
      })
      .filter((p) => p.reasons.length)
      .sort((a, b2) => b2.reasons.length - a.reasons.length || a.code.localeCompare(b2.code))
      .slice(0, 10),
  );

  return { portfolio, health: healthCounts, overBudgetTrend, delivery, margins: marginRows, attention };
}

/** Health status of a project as of the end of `month`, from monthly minutes (M4 rules). */
function healthAt(
  p: { id: string; contractType: ContractType | null; startDate: Date; budget: { budgetHours: unknown; retainerHoursPerMonth: unknown; rolloverMode: "none" | "full" | "capped"; rolloverCapHours: unknown; alertThresholds: number[] } | null },
  minutes: MonthMinutes,
  frozen: { projectId: string; month: Date; hoursPerMonth: unknown; rolloverMode: "none" | "full" | "capped"; rolloverCapHours: unknown }[],
  month: IsoDate,
): HealthStatus {
  const b = p.budget!;
  const thresholds = normalizeThresholds(b.alertThresholds);
  const empty = { inScope: 0, pending: 0, approved: 0 };
  const dec = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  if (p.contractType === "retainer" && dec(b.retainerHoursPerMonth)) {
    const start = monthStart(isoDate(p.startDate));
    if (month < start) return "no_budget";
    const current = { hoursPerMonth: dec(b.retainerHoursPerMonth)!, rolloverMode: b.rolloverMode, capHours: dec(b.rolloverCapHours) };
    const list = retainerMonths(
      monthsBetween(start, month).map((mo) => {
        const f = frozen.find((x) => x.projectId === p.id && isoDate(x.month) === mo);
        return {
          month: mo,
          settings: f ? { hoursPerMonth: Number(f.hoursPerMonth), rolloverMode: f.rolloverMode, capHours: dec(f.rolloverCapHours) } : current,
          minutes: minutes.get(mo) ?? empty,
        };
      }),
      thresholds,
    );
    return list[list.length - 1]?.status ?? "no_budget";
  }
  const total = { ...empty };
  for (const [mo, v] of minutes) {
    if (mo > month) continue;
    total.inScope += v.inScope;
    total.pending += v.pending;
    total.approved += v.approved;
  }
  return snapshot(dec(b.budgetHours), total, thresholds).status;
}

// ---------------------------------------------------------------------------
// §6 Team utilization
// ---------------------------------------------------------------------------

type UtilEntry = { user_id: string; day: Date; is_billable: boolean; oos_status: OosStatus; kind: "client" | "internal" | null; category: string | null; minutes: number };

export type PersonUtilization = {
  id: string;
  name: string;
  role: UserRole;
  available: number | null;
  logged: number;
  billable: number;
  utilization: number | null;
  target: number;
  status: UtilizationStatus | null;
  emptyDays: number;
};

export type HoursComposition = { billable: number; outOfScope: number; internal: number; categories: { name: string; hours: number }[]; total: number };

export async function loadUtilization(cc: ClevelContext) {
  const b = await base(cc);
  const twelve = lastMonths(cc.today, 12);
  const earliest = [twelve[0]!, cc.period.start].sort()[0]!;
  const ahead8 = { start: addDays(cc.today, 1), end: addDays(cc.today, 56) };
  const data = await rls(cc, async (tx) => ({
    entries: await tx.$queryRaw<UtilEntry[]>`
      SELECT e.user_id::text, e.entry_date AS day, e.is_billable, e.oos_status, p.kind::text AS kind, c.name AS category, SUM(e.minutes)::int AS minutes
      FROM time_entries e
      LEFT JOIN projects p ON p.id = e.project_id
      LEFT JOIN work_categories c ON c.id = e.category_id
      WHERE e.entry_date >= ${earliest}::date AND e.entry_date <= ${cc.today}::date
      GROUP BY 1, 2, 3, 4, 5, 6`,
    tasks: await tx.task.findMany({
      where: { status: { not: "done" }, dueDate: { gte: parseIsoDate(ahead8.start), lte: parseIsoDate(ahead8.end) }, section: { archivedAt: null }, project: { status: { in: ["active", "on_hold"] } } },
      select: { dueDate: true, estimateHours: true, owner: { select: { role: true } } },
    }),
  }));
  const entries = data.entries.map((e) => ({ ...e, d: isoDate(e.day) }));
  const people = b.people.filter((p) => p.role !== "c_level" && (p.active || (p.employment.activeTo !== null && p.employment.activeTo >= cc.period.start)));
  const band = b.settings.clevel_dashboard_thresholds.utilizationBand;
  const isBillable = (e: UtilEntry) => e.is_billable && e.oos_status !== "pending";

  const perPerson = (w: Window): PersonUtilization[] =>
    people.map((p) => {
      const mine = entries.filter((e) => e.user_id === p.id && inWindow(e.d, w));
      const logged = round2(mine.reduce((s, e) => s + e.minutes, 0) / 60);
      const billable = round2(mine.filter(isBillable).reduce((s, e) => s + e.minutes, 0) / 60);
      const available = availableHours(p.capacity, p.overrides, p.employment, w, b.settings.workdays);
      const utilization = utilizationPct(billable, available);
      const loggedDays = new Set(mine.map((e) => e.d));
      const past = overlap(w, { start: w.start, end: addDays(cc.today, -1) });
      const emptyDays = past ? workdaysIn(past, b.settings.workdays).filter((d) => !loggedDays.has(d) && !p.overrides.some((o) => o.start <= d && d <= o.end && o.availableHours === 0)).length : 0;
      return { id: p.id, name: p.name, role: p.role, available, logged, billable, utilization, target: p.target ?? 0, status: utilizationStatus({ utilization, target: p.target ?? 0, logged, available }, band), emptyDays };
    });

  const aggregate = (rows: PersonUtilization[]) => {
    const available = round2(rows.reduce((s, r) => s + (r.available ?? 0), 0));
    const billable = round2(rows.reduce((s, r) => s + r.billable, 0));
    return {
      available,
      billable,
      logged: round2(rows.reduce((s, r) => s + r.logged, 0)),
      utilization: utilizationPct(billable, available),
      target: weightedTarget(rows.filter((r) => r.available).map((r) => ({ target: r.target, available: r.available! }))),
      people: rows.length,
    };
  };

  const rows = perPerson(cc.period);
  const studio = aggregate(rows);
  const previous = aggregate(perPerson(cc.prev));
  const roles = [...new Set(rows.map((r) => r.role))].map((role) => ({ role, ...aggregate(rows.filter((r) => r.role === role)) }));
  // The overview's 1, 3 and 6 month views: the last n months up to today,
  // each against the n months before it.
  const ranges = ([1, 3, 6] as const).map((n) => {
    const start = lastMonths(cc.today, n)[0]!;
    const cur = perPerson({ start, end: cc.today });
    const before = aggregate(perPerson({ start: addMonths(start, -n), end: addDays(start, -1) }));
    const s = aggregate(cur);
    const byRole = [...new Set(cur.map((r) => r.role))].map((role) => ({ role, ...aggregate(cur.filter((r) => r.role === role)) }));
    return { months: n, studio: s, roles: byRole, change: delta(s.utilization ?? 0, before.utilization ?? 0).change };
  });
  const trend = twelve.map((mo) => {
    const a = aggregate(perPerson(monthWindow(mo, cc.today)));
    return { month: mo, utilization: a.utilization, target: a.target };
  });

  // 6.4 Hours composition
  const composition = (filter: (userId: string) => boolean): HoursComposition => {
    const list = entries.filter((e) => filter(e.user_id) && inWindow(e.d, cc.period));
    const h = (xs: typeof list) => round2(xs.reduce((s, e) => s + e.minutes, 0) / 60);
    const cats = new Map<string, number>();
    for (const e of list.filter((e) => !e.kind)) cats.set(e.category ?? "Other", (cats.get(e.category ?? "Other") ?? 0) + e.minutes);
    return {
      billable: h(list.filter((e) => e.kind === "client" && e.oos_status !== "pending" && e.oos_status !== "approved")),
      outOfScope: h(list.filter((e) => e.oos_status === "pending" || e.oos_status === "approved")),
      internal: h(list.filter((e) => e.kind === "internal" && e.oos_status !== "pending" && e.oos_status !== "approved")),
      categories: [...cats].map(([name, minutes]) => ({ name, hours: round2(minutes / 60) })).sort((a, b2) => b2.hours - a.hours),
      total: h(list),
    };
  };
  const roleOf = new Map(people.map((p) => [p.id, p.role]));
  const compositionStudio = composition((u) => roleOf.has(u));
  const compositionRoles = roles.map((r) => ({ role: r.role, ...composition((u) => roleOf.get(u) === r.role) }));

  // 6.5 Capacity ahead
  const ahead = [4, 8].map((weeks) => {
    const w = { start: addDays(cc.today, 1), end: addDays(cc.today, weeks * 7) };
    const tasks = data.tasks.filter((t) => isoDate(t.dueDate!) <= w.end);
    const perRole = [...new Set(people.map((p) => p.role))].map((role) => {
      const team = people.filter((p) => p.role === role && p.active);
      const available = round2(team.reduce((s, p) => s + (availableHours(p.capacity, p.overrides, p.employment, w, b.settings.workdays) ?? 0), 0));
      const targeted = round2(team.reduce((s, p) => s + ((availableHours(p.capacity, p.overrides, p.employment, w, b.settings.workdays) ?? 0) * (p.target ?? 0)) / 100, 0));
      const scheduled = round2(tasks.filter((t) => t.owner?.role === role).reduce((s, t) => s + numOr0(t.estimateHours), 0));
      const remaining = round2(targeted - scheduled);
      return { role, available, targeted, scheduled, remaining, status: capacityStatus(remaining, targeted) as CapacityStatus };
    });
    const sum = (k: "available" | "targeted" | "scheduled" | "remaining") => round2(perRole.reduce((s, r) => s + r[k], 0));
    return {
      weeks,
      available: sum("available"),
      targeted: sum("targeted"),
      scheduled: sum("scheduled"),
      remaining: sum("remaining"),
      perRole,
      unestimated: tasks.filter((t) => t.estimateHours === null).length,
      unassigned: round2(tasks.filter((t) => !t.owner).reduce((s, t) => s + numOr0(t.estimateHours), 0)),
    };
  });

  return { studio, previous, change: delta(studio.utilization ?? 0, previous.utilization ?? 0), trend, roles, ranges, people: rows, compositionStudio, compositionRoles, ahead };
}

