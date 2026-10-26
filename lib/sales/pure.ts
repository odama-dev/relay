import type { StageCategory } from "@prisma/client";
import { addDays, addMonths, monthStart, parseIsoDate, type IsoDate } from "@/lib/time/pure";

/**
 * Sales math (PRD Phase 2 "Sales"). Every figure reads the stage's category
 * (Open / Won / Lost), never its name, so renaming or adding stages doesn't
 * change a report. Values are IDR estimates; a deal without a rate is
 * counted apart (`unconverted`) rather than as zero.
 */

/** Where a lead came from — the list Sales picks from (CHECK deals_lead_source). */
export const LEAD_SOURCES = ["dribbble", "website", "email", "contra", "behance", "referral", "other"] as const;

/** Stage names from before the outreach pipeline (Oct 2026), as an import may still carry them. */
const LEGACY_STAGES: Record<string, string> = {
  lead: "researched",
  qualified: "contacted",
  "discovery call": "call booked",
  committed: "proposal",
  "proposal sent": "proposal",
  negotiation: "proposal",
};

/** A stage name from a file → the pipeline stage it means (lower-cased); current names win over legacy ones. */
export function resolveStageName(name: string, stages: Map<string, string>): string | undefined {
  const key = name.trim().toLowerCase();
  return stages.get(key) ?? stages.get(LEGACY_STAGES[key] ?? "");
}
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  dribbble: "Dribbble",
  website: "Website",
  email: "Email",
  contra: "Contra",
  behance: "Behance",
  referral: "Referral / networking",
  other: "Others",
};
export const LEAD_TYPES = ["inbound", "outbound"] as const;

/** A free-text source (Attio export, old data) mapped onto the list; empty stays empty. */
export function normalizeLeadSource(raw: string | null | undefined): LeadSource | null {
  const v = raw?.trim().toLowerCase();
  if (!v) return null;
  if ((LEAD_SOURCES as readonly string[]).includes(v)) return v as LeadSource;
  if (v.startsWith("dribbb")) return "dribbble";
  if (v.includes("website") || v === "web") return "website";
  if (v.includes("mail")) return "email";
  if (v.startsWith("contra")) return "contra";
  if (v.startsWith("behance")) return "behance";
  if (v.includes("referral") || v.includes("network") || v === "existing client") return "referral";
  return "other";
}

const DAY_MS = 86_400_000;
// `|| 0` turns -0 (a sum that rounds to nothing) into 0.
const round2 = (n: number) => Math.round(n * 100) / 100 || 0;

export type DealFacts = {
  category: StageCategory;
  /** IDR estimate of the value; null when its currency has no rate. */
  valueIdr: number | null;
  probability: number;
  createdOn: IsoDate;
  closedOn: IsoDate | null;
  /** Day it entered its current stage. */
  stageSince: IsoDate;
};

const inWindow = (d: IsoDate | null, from: IsoDate, to: IsoDate) => d !== null && d >= from && d <= to;

/** Total pipeline (open value) and weighted pipeline (value × probability). */
export function pipelineTotals(deals: DealFacts[]) {
  let openIdr = 0;
  let weightedIdr = 0;
  let openCount = 0;
  let unconverted = 0;
  for (const d of deals) {
    if (d.category !== "open") continue;
    openCount++;
    if (d.valueIdr === null) {
      unconverted++;
      continue;
    }
    openIdr += d.valueIdr;
    weightedIdr += (d.valueIdr * d.probability) / 100;
  }
  return { openIdr: round2(openIdr), weightedIdr: round2(weightedIdr), openCount, unconverted };
}

/** Won ÷ (won + lost) among deals closed in the window; null when none closed. */
export function winRate(deals: DealFacts[], from: IsoDate, to: IsoDate) {
  const closed = deals.filter((d) => d.category !== "open" && inWindow(d.closedOn, from, to));
  const won = closed.filter((d) => d.category === "won").length;
  return { won, lost: closed.length - won, rate: closed.length ? Math.round((won / closed.length) * 1000) / 10 : null };
}

/** Average days from created to won, for deals won in the window. */
export function avgDealDays(deals: DealFacts[], from: IsoDate, to: IsoDate): number | null {
  const won = deals.filter((d) => d.category === "won" && inWindow(d.closedOn, from, to));
  if (!won.length) return null;
  const days = won.map((d) => Math.max(0, (parseIsoDate(d.closedOn!).getTime() - parseIsoDate(d.createdOn).getTime()) / DAY_MS));
  return Math.round(days.reduce((a, b) => a + b, 0) / won.length);
}

/** Deals created in the window ("lead baru"). */
export const newLeads = (deals: DealFacts[], from: IsoDate, to: IsoDate) => deals.filter((d) => inWindow(d.createdOn, from, to)).length;

/** An open deal that hasn't changed stage for more than `days` days. */
export function isStale(category: StageCategory, stageSince: IsoDate, today: IsoDate, days: number): boolean {
  return category === "open" && stageSince < addDays(today, -days);
}

// ---------------------------------------------------------------------------
// Monthly report
// ---------------------------------------------------------------------------

export type Candle = { month: IsoDate; open: number; high: number; low: number; close: number; days: number };

/**
 * One candle per month from the daily pipeline snapshots: the first, highest,
 * lowest and last open value. Months before the first snapshot have none —
 * the pipeline can't be reconstructed backwards.
 */
export function monthlyCandles(snapshots: { date: IsoDate; openIdr: number }[]): Candle[] {
  const byMonth = new Map<IsoDate, { date: IsoDate; openIdr: number }[]>();
  for (const s of [...snapshots].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const m = monthStart(s.date);
    byMonth.set(m, [...(byMonth.get(m) ?? []), s]);
  }
  return [...byMonth].map(([month, rows]) => {
    const values = rows.map((r) => r.openIdr);
    return { month, open: values[0]!, close: values.at(-1)!, high: Math.max(...values), low: Math.min(...values), days: rows.length };
  });
}

/** A deal entering a stage (deal_stage_history), oldest first. */
export type StageMove = { dealId: string; on: IsoDate; to: StageCategory; valueIdr: number | null };

/** Open value at the start of `day`: each deal's last move before it, when that left it open. */
export function openValueAt(moves: StageMove[], day: IsoDate): number {
  const last = new Map<string, StageMove>();
  for (const m of moves) if (m.on < day) last.set(m.dealId, m);
  let total = 0;
  for (const m of last.values()) if (m.to === "open") total += m.valueIdr ?? 0;
  return round2(total);
}

export type Bridge = { month: IsoDate; start: number; added: number; won: number; lost: number; adjusted: number; end: number };

/**
 * Pipeline bridge for a month: start + new (or reopened) − won − lost = end.
 * `adjusted` is what value edits inside open stages moved, so the bridge
 * always closes. `liveEnd` replaces the end for the running month (today's
 * values, not the last move's).
 */
export function pipelineBridge(moves: StageMove[], month: IsoDate, liveEnd?: number): Bridge {
  const next = addMonths(month, 1);
  const start = openValueAt(moves, month);
  const state = new Map<string, StageMove>();
  for (const m of moves) if (m.on < month) state.set(m.dealId, m);
  let added = 0;
  let won = 0;
  let lost = 0;
  for (const m of moves) {
    if (m.on < month || m.on >= next) continue;
    const before = state.get(m.dealId);
    const wasOpen = before?.to === "open";
    if (!wasOpen && m.to === "open") added += m.valueIdr ?? 0;
    if (wasOpen && m.to === "won") won += m.valueIdr ?? 0;
    if (wasOpen && m.to === "lost") lost += m.valueIdr ?? 0;
    state.set(m.dealId, m);
  }
  const end = liveEnd ?? openValueAt(moves, next);
  return { month, start, added: round2(added), won: round2(won), lost: round2(lost), adjusted: round2(end - (start + added - won - lost)), end: round2(end) };
}

// ---------------------------------------------------------------------------
// Sales report — funnel, lead sources, money won per month
// ---------------------------------------------------------------------------

export type FunnelDeal = {
  /** Board position of the furthest open stage the deal reached; null if none. */
  furthestOpen: number | null;
  won: boolean;
  valueIdr: number | null;
};
export type FunnelStep = { label: string; position: number | "won" };

/**
 * How many deals reached each step (and their IDR value). Reaching a later
 * open stage — or winning — counts for every earlier step, so a deal that
 * skipped a stage still flows through the funnel.
 */
export function funnel(deals: FunnelDeal[], steps: FunnelStep[]) {
  return steps.map((s) => {
    const reached = deals.filter((d) => d.won || (s.position !== "won" && d.furthestOpen !== null && d.furthestOpen >= s.position));
    return { label: s.label, deals: reached.length, valueIdr: round2(reached.reduce((sum, d) => sum + (d.valueIdr ?? 0), 0)) };
  });
}

export type SourceDeal = { source: LeadSource | null; category: StageCategory; valueIdr: number | null };

/** Per lead source: leads, won, lost, win rate of the closed ones, and IDR won. Sources with no leads are left out. */
export function leadSourceComparison(deals: SourceDeal[]) {
  const keys: (LeadSource | "unknown")[] = [...LEAD_SOURCES, "unknown"];
  return keys
    .map((key) => {
      const mine = deals.filter((d) => (d.source ?? "unknown") === key);
      const won = mine.filter((d) => d.category === "won");
      const lost = mine.filter((d) => d.category === "lost").length;
      return {
        source: key,
        label: key === "unknown" ? "Not set" : LEAD_SOURCE_LABELS[key],
        leads: mine.length,
        won: won.length,
        lost,
        winRate: won.length + lost > 0 ? Math.round((won.length / (won.length + lost)) * 100) : null,
        wonIdr: round2(won.reduce((s, d) => s + (d.valueIdr ?? 0), 0)),
      };
    })
    .filter((r) => r.leads > 0);
}

/** IDR value of the deals won in each month (`yyyy-mm-01` keys, in order). */
export function wonByMonth(deals: { category: StageCategory; closedOn: IsoDate | null; valueIdr: number | null }[], months: IsoDate[]) {
  return months.map((month) => {
    const won = deals.filter((d) => d.category === "won" && d.closedOn !== null && monthStart(d.closedOn) === month);
    return { month, deals: won.length, valueIdr: round2(won.reduce((s, d) => s + (d.valueIdr ?? 0), 0)) };
  });
}
