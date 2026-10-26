import "server-only";
import type { StageCategory } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { numOr0 } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { idrRateMap as idrRates } from "@/lib/fx";
import { estimateIdr } from "@/lib/clevel/pure";
import { OPTION_COLORS, type OptionColor } from "@/lib/crm/pure";
import { countryCounts } from "@/lib/geo/pure";
import { addDays, addMonths, isoDate, monthStart, parseIsoDate, todayIn, type IsoDate } from "@/lib/time/pure";
import {
  avgDealDays,
  funnel,
  isStale,
  leadSourceComparison,
  wonByMonth,
  type FunnelStep,
  LEAD_SOURCE_LABELS,
  normalizeLeadSource,
  type LeadSource,
  monthlyCandles,
  newLeads,
  pipelineTotals,
  winRate,
  type DealFacts,
} from "@/lib/sales/pure";

/** Win rate and deal duration look at deals closed in this many days. */
export const CLOSED_WINDOW_DAYS = 90;

export type StageView = {
  id: string;
  name: string;
  category: StageCategory;
  probability: number;
  position: number;
  isHidden: boolean;
  /** Email moves deals into it: "contacted" (you wrote) or "replied" (they answered). */
  autoKey: "contacted" | "replied" | null;
  /** The board dot's colour; null follows the category. */
  color: OptionColor | null;
  deals: number;
};

export type DealView = {
  id: string;
  title: string;
  client: { id: string; name: string } | null;
  prospectName: string | null;
  value: number;
  currency: string;
  valueIdr: number | null;
  probability: number;
  expectedClose: IsoDate | null;
  owner: { id: string; name: string } | null;
  person: { id: string; name: string; email: string | null } | null;
  company: { id: string; name: string } | null;
  leadDate: IsoDate;
  lastContactOn: IsoDate | null;
  leadSource: LeadSource | null;
  leadType: "inbound" | "outbound" | null;
  serviceType: string | null;
  lostReason: string | null;
  notes: string | null;
  lastStageId: string | null;
  stageId: string;
  category: StageCategory;
  stageSince: IsoDate;
  stale: boolean;
  daysInStage: number;
  closedOn: IsoDate | null;
  createdOn: IsoDate;
  project: { id: string; code: string } | null;
};

export type PipelineFilters = { q?: string; ownerId?: string; from?: IsoDate; to?: IsoDate; dealId?: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function parsePipelineFilters(sp: Record<string, string | string[] | undefined>): PipelineFilters {
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const date = (k: string) => {
    const v = get(k);
    return v && ISO.test(v) ? (v as IsoDate) : undefined;
  };
  return { q: get("q")?.trim() || undefined, ownerId: get("owner"), from: date("from"), to: date("to"), dealId: get("deal") };
}

/**
 * The pipeline (RLS: Sales and Studio Report): stages in order, deals with
 * their IDR estimate and staleness, and the top cards. With a date range,
 * open deals are those that came in within it and won / lost ones those
 * closed within it (win rate and deal length too); without one, every open
 * deal and the last 30 days of won / lost.
 */
export async function loadPipeline(user: CurrentUser, f: PipelineFilters) {
  const today = todayIn(user.timezone);
  const settings = await getSettings();
  const staleDays = settings.sales_stale_days;
  return asUser(user, async (tx) => {
    const [stages, deals, overdueInvoices] = await Promise.all([
      tx.pipelineStage.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: { _count: { select: { deals: true } } } }),
      tx.deal.findMany({
        include: {
          client: { select: { id: true, name: true } },
          person: { select: { id: true, name: true, email: true } },
          company: { select: { id: true, name: true } },
          owner: { select: { id: true, fullName: true } },
          project: { select: { id: true, code: true } },
          stage: { select: { category: true } },
        },
        orderBy: [{ stageChangedAt: "desc" }],
      }),
      // Same rule as the Sales dashboard's "late": an open invoice with a pending request past due.
      tx.invoice.count({
        where: {
          status: { in: ["sent", "partially_paid", "payment_submitted", "overdue"] },
          paymentRequests: { some: { status: "pending", dueDate: { lt: parseIsoDate(today) } } },
        },
      }),
    ]);
    const rates = await idrRates(tx, deals.map((d) => d.currency), today);
    const all: DealView[] = deals.map((d) => {
      const stageSince = todayIn(user.timezone, d.stageChangedAt);
      const value = numOr0(d.value);
      return {
        id: d.id,
        title: d.title,
        client: d.client,
        prospectName: d.prospectName,
        value,
        currency: d.currency,
        valueIdr: estimateIdr(value, d.currency, rates),
        probability: d.probability,
        expectedClose: d.expectedClose ? isoDate(d.expectedClose) : null,
        owner: d.owner ? { id: d.owner.id, name: d.owner.fullName } : null,
        person: d.person,
        company: d.company,
        leadDate: isoDate(d.leadDate),
        lastContactOn: d.lastContactOn ? isoDate(d.lastContactOn) : null,
        leadSource: normalizeLeadSource(d.leadSource),
        leadType: d.leadType,
        serviceType: d.serviceType,
        lostReason: d.lostReason,
        notes: d.notes,
        lastStageId: d.lastStageId,
        stageId: d.stageId,
        category: d.stage.category,
        stageSince,
        stale: isStale(d.stage.category, stageSince, today, staleDays),
        daysInStage: Math.max(0, Math.round((parseIsoDate(today).getTime() - parseIsoDate(stageSince).getTime()) / 86_400_000)),
        closedOn: d.closedAt ? todayIn(user.timezone, d.closedAt) : null,
        createdOn: isoDate(d.leadDate),
        project: d.project,
      };
    });

    const facts: DealFacts[] = all.map((d) => ({ ...d }));
    const windowFrom = f.from ?? addDays(today, -CLOSED_WINDOW_DAYS);
    const windowTo = f.to ?? today;
    const totals = pipelineTotals(facts);
    const cards = {
      ...totals,
      winRate: winRate(facts, windowFrom, windowTo),
      avgDays: avgDealDays(facts, windowFrom, windowTo),
      newLeads: newLeads(facts, monthStart(today), today),
      overdueInvoices,
      stale: all.filter((d) => d.stale).length,
    };

    const ranged = Boolean(f.from || f.to);
    const from = f.from ?? (ranged ? "0000-01-01" : addDays(today, -30));
    const to = f.to ?? "9999-12-31";
    const inRange = (d: DealView) => {
      if (d.category !== "open") return (d.closedOn ?? today) >= from && (d.closedOn ?? today) <= to;
      return !ranged || (d.createdOn >= from && d.createdOn <= to);
    };
    const q = f.q?.toLowerCase();
    // A deal opened by link (?deal=) always shows, whatever the filters.
    const visible = all.filter(
      (d) =>
        d.id === f.dealId ||
        (!f.ownerId || d.owner?.id === f.ownerId) &&
        (!q || [d.title, d.client?.name, d.prospectName, d.company?.name, d.person?.name, d.serviceType, d.leadSource && LEAD_SOURCE_LABELS[d.leadSource]].some((s) => s?.toLowerCase().includes(q))) &&
        inRange(d),
    );
    return {
      today,
      staleDays,
      stages: stages.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        probability: s.probability,
        position: s.position,
        isHidden: s.isHidden,
        autoKey: s.autoKey === "contacted" || s.autoKey === "replied" ? s.autoKey : null,
        color: (OPTION_COLORS as readonly string[]).includes(s.color ?? "") ? (s.color as OptionColor) : null,
        deals: s._count.deals,
      })) satisfies StageView[],
      deals: visible,
      owners: [...new Map(all.filter((d) => d.owner).map((d) => [d.owner!.id, d.owner!])).values()].sort((a, b) => a.name.localeCompare(b.name)),
      cards,
    };
  });
}

export type PipelineData = Awaited<ReturnType<typeof loadPipeline>>;

/** Open pipeline candles (PRD "Report bulanan") from the daily snapshots in the months of `from`–`to`, in IDR. */
export async function loadSalesReport(user: CurrentUser, from: IsoDate, to: IsoDate) {
  return asUser(user, async (tx) => {
    const snapshots = await tx.pipelineSnapshot.findMany({ where: { date: { gte: parseIsoDate(monthStart(from)), lt: parseIsoDate(addMonths(monthStart(to), 1)) } }, orderBy: { date: "asc" } });
    return {
      firstSnapshot: snapshots[0] ? isoDate(snapshots[0].date) : null,
      candles: monthlyCandles(snapshots.map((s) => ({ date: isoDate(s.date), openIdr: numOr0(s.openIdr) }))),
    };
  });
}

/** The first lead date on record (the start of "All time"); null when there are no deals. */
export async function loadFirstLeadDate(user: CurrentUser) {
  const first = await asUser(user, (tx) => tx.deal.aggregate({ _min: { leadDate: true } }));
  return first._min.leadDate ? isoDate(first._min.leadDate) : null;
}

/**
 * Daily job (Phase 2 · M9): today's open and weighted pipeline in IDR. One
 * row per day, overwritten if run again; the candle chart reads these and
 * can't be rebuilt for days that weren't recorded.
 */
export async function snapshotPipeline(today = todayIn("Asia/Jakarta")) {
  const deals = await prisma.deal.findMany({ where: { stage: { category: "open" } }, select: { value: true, currency: true, probability: true } });
  const rates = await idrRates(prisma, deals.map((d) => d.currency), today);
  const totals = pipelineTotals(
    deals.map((d) => ({ category: "open" as const, valueIdr: estimateIdr(numOr0(d.value), d.currency, rates), probability: d.probability, createdOn: today, closedOn: null, stageSince: today })),
  );
  const date = parseIsoDate(today);
  const data = { openIdr: totals.openIdr, weightedIdr: totals.weightedIdr, openCount: totals.openCount };
  await prisma.pipelineSnapshot.upsert({ where: { date }, create: { date, ...data }, update: data });
  return { date: today, ...data, unconverted: totals.unconverted };
}

/**
 * Sales report insights: the funnel (each visible open stage — Researched →
 * Contacted → Replied → Call booked → Proposal — then Closed won) and the
 * lead-source comparison over every lead on record, and the IDR won per
 * month over the deals closed within `from`–`to` (the report period).
 */
export async function loadSalesInsights(user: CurrentUser, from: IsoDate, to: IsoDate) {
  const today = todayIn(user.timezone);
  return asUser(user, async (tx) => {
    const [stages, deals] = await Promise.all([
      tx.pipelineStage.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, category: true, isHidden: true } }),
      tx.deal.findMany({
        select: {
          id: true,
          value: true,
          currency: true,
          leadDate: true,
          leadSource: true,
          closedAt: true,
          stageId: true,
          stage: { select: { category: true } },
          history: { select: { toStageId: true } },
        },
      }),
    ]);
    const rates = await idrRates(tx, deals.map((d) => d.currency), today);
    const order = new Map(stages.map((s, i) => [s.id, i]));
    const openIds = new Set(stages.filter((s) => s.category === "open").map((s) => s.id));
    const facts = deals.map((d) => {
      const reached = [d.stageId, ...d.history.map((h) => h.toStageId)].filter((id) => openIds.has(id)).map((id) => order.get(id) ?? -1);
      return {
        category: d.stage.category,
        source: normalizeLeadSource(d.leadSource),
        closedOn: d.closedAt ? todayIn(user.timezone, d.closedAt) : null,
        valueIdr: estimateIdr(numOr0(d.value), d.currency, rates),
        furthestOpen: reached.length ? Math.max(...reached) : null,
      };
    });
    const closed = facts.filter((f) => f.category === "won" && f.closedOn !== null && f.closedOn >= from && f.closedOn <= to);
    const steps: FunnelStep[] = [
      ...stages.flatMap((s, i) => (s.category === "open" && !s.isHidden ? [{ label: s.name, position: i }] : [])),
      { label: "Closed won", position: "won" as const },
    ];
    const months: IsoDate[] = [];
    for (let m = monthStart(from); m <= to; m = addMonths(m, 1)) months.push(m);
    return {
      funnel: funnel(facts.map((f) => ({ furthestOpen: f.furthestOpen, won: f.category === "won", valueIdr: f.valueIdr })), steps),
      sources: leadSourceComparison(facts),
      won: wonByMonth(closed, months),
      leads: facts.length,
      unconverted: closed.filter((f) => f.valueIdr === null).length,
    };
  });
}

/**
 * The country tracker: companies (prospects and clients) per country, under
 * the viewer's RLS. A company without its own country falls back to its
 * client's; a client that isn't in Companies yet counts on its own.
 */
export async function loadCompanyCountries(user: CurrentUser) {
  const [companies, clients] = await asUser(user, (tx) =>
    Promise.all([
      tx.crmCompany.findMany({ where: { archivedAt: null }, select: { country: true, client: { select: { country: true } } } }),
      tx.client.findMany({ where: { isArchived: false, crmCompany: null }, select: { country: true } }),
    ]),
  );
  return countryCounts([...companies.map((c) => c.country ?? c.client?.country), ...clients.map((c) => c.country)]);
}
