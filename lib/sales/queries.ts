import "server-only";
import type { StageCategory } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { numOr0 } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { idrRateMap as idrRates } from "@/lib/fx";
import { estimateIdr } from "@/lib/clevel/pure";
import { addDays, addMonths, isoDate, monthStart, parseIsoDate, todayIn, type IsoDate } from "@/lib/time/pure";
import {
  avgDealDays,
  isStale,
  monthlyCandles,
  newLeads,
  pipelineBridge,
  pipelineTotals,
  winRate,
  type DealFacts,
  type StageMove,
} from "@/lib/sales/pure";

/** Win rate and deal duration look at deals closed in this many days. */
export const CLOSED_WINDOW_DAYS = 90;

export type StageView = { id: string; name: string; category: StageCategory; probability: number; position: number; deals: number };

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
  leadSource: string | null;
  serviceType: string | null;
  lostReason: string | null;
  notes: string | null;
  stageId: string;
  category: StageCategory;
  stageSince: IsoDate;
  stale: boolean;
  daysInStage: number;
  closedOn: IsoDate | null;
  createdOn: IsoDate;
  project: { id: string; code: string } | null;
};

export type PipelineFilters = { q?: string; ownerId?: string; closed: "recent" | "all" };

export function parsePipelineFilters(sp: Record<string, string | string[] | undefined>): PipelineFilters {
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  return { q: get("q")?.trim() || undefined, ownerId: get("owner"), closed: get("closed") === "all" ? "all" : "recent" };
}

/**
 * The pipeline (RLS: Sales and Studio Report): stages in order, deals with
 * their IDR estimate and staleness, and the top cards. Won / Lost columns
 * show the last 30 days unless `closed=all`.
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
        leadSource: d.leadSource,
        serviceType: d.serviceType,
        lostReason: d.lostReason,
        notes: d.notes,
        stageId: d.stageId,
        category: d.stage.category,
        stageSince,
        stale: isStale(d.stage.category, stageSince, today, staleDays),
        daysInStage: Math.max(0, Math.round((parseIsoDate(today).getTime() - parseIsoDate(stageSince).getTime()) / 86_400_000)),
        closedOn: d.closedAt ? todayIn(user.timezone, d.closedAt) : null,
        createdOn: todayIn(user.timezone, d.createdAt),
        project: d.project,
      };
    });

    const facts: DealFacts[] = all.map((d) => ({ ...d }));
    const windowFrom = addDays(today, -CLOSED_WINDOW_DAYS);
    const totals = pipelineTotals(facts);
    const cards = {
      ...totals,
      winRate: winRate(facts, windowFrom, today),
      avgDays: avgDealDays(facts, windowFrom, today),
      newLeads: newLeads(facts, monthStart(today), today),
      overdueInvoices,
      stale: all.filter((d) => d.stale).length,
    };

    const recentFrom = addDays(today, -30);
    const q = f.q?.toLowerCase();
    const visible = all.filter(
      (d) =>
        (!f.ownerId || d.owner?.id === f.ownerId) &&
        (!q || [d.title, d.client?.name, d.prospectName, d.serviceType, d.leadSource].some((s) => s?.toLowerCase().includes(q))) &&
        (f.closed === "all" || d.category === "open" || (d.closedOn ?? today) >= recentFrom),
    );
    return {
      today,
      staleDays,
      stages: stages.map((s) => ({ id: s.id, name: s.name, category: s.category, probability: s.probability, position: s.position, deals: s._count.deals })),
      deals: visible,
      owners: [...new Map(all.filter((d) => d.owner).map((d) => [d.owner!.id, d.owner!])).values()].sort((a, b) => a.name.localeCompare(b.name)),
      cards,
    };
  });
}

export type PipelineData = Awaited<ReturnType<typeof loadPipeline>>;

/**
 * Monthly report (PRD "Report bulanan"): candles from the daily snapshots
 * and a bridge per month from the stage history, both in IDR.
 */
export async function loadSalesReport(user: CurrentUser, months = 6) {
  const today = todayIn(user.timezone);
  const first = addMonths(monthStart(today), -(months - 1));
  return asUser(user, async (tx) => {
    const [snapshots, history, deals] = await Promise.all([
      tx.pipelineSnapshot.findMany({ where: { date: { gte: parseIsoDate(first) } }, orderBy: { date: "asc" } }),
      tx.dealStageHistory.findMany({ orderBy: { changedAt: "asc" }, select: { dealId: true, toStageId: true, value: true, currency: true, changedAt: true } }),
      tx.deal.findMany({ select: { value: true, currency: true, probability: true, stage: { select: { category: true } } } }),
    ]);
    const stages = new Map((await tx.pipelineStage.findMany({ select: { id: true, category: true } })).map((s) => [s.id, s.category]));
    const rates = await idrRates(tx, [...history, ...deals].map((d) => d.currency), today);
    const moves: StageMove[] = history.map((h) => ({
      dealId: h.dealId,
      on: todayIn(user.timezone, h.changedAt),
      to: stages.get(h.toStageId) ?? "open",
      valueIdr: estimateIdr(numOr0(h.value), h.currency, rates),
    }));
    const live = pipelineTotals(
      deals.map((d) => ({ category: d.stage.category, valueIdr: estimateIdr(numOr0(d.value), d.currency, rates), probability: d.probability, createdOn: today, closedOn: null, stageSince: today })),
    );
    const monthList = Array.from({ length: months }, (_, i) => addMonths(first, i));
    const thisMonth = monthStart(today);
    return {
      today,
      firstSnapshot: snapshots[0] ? isoDate(snapshots[0].date) : null,
      candles: monthlyCandles(snapshots.map((s) => ({ date: isoDate(s.date), openIdr: numOr0(s.openIdr) }))),
      bridges: monthList.map((m) => pipelineBridge(moves, m, m === thisMonth ? live.openIdr : undefined)),
      unconverted: live.unconverted,
    };
  });
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
