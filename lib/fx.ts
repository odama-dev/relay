import "server-only";
import { prisma } from "@/lib/prisma";
import { numOr0 } from "@/lib/money";
import { parseIsoDate, type IsoDate } from "@/lib/time/pure";
import type { Tx } from "@/lib/db";

/**
 * Indicative exchange rates for normalising summaries to IDR. Frankfurter
 * (ECB reference rates, no key); there is no public Google currency API.
 * Never used for invoicing or settlement — those amounts come from Xendit.
 */

export type IdrRates = {
  /** ECB reference date, yyyy-mm-dd. */
  date: string;
  /** IDR per one unit of each currency; IDR itself is 1. */
  toIdr: Record<string, number>;
};

const ENDPOINT = "https://api.frankfurter.dev/v1/latest";

/** Rates to IDR for `currencies`, cached for 6 hours; null when the API is unreachable. */
export async function getIdrRates(currencies: string[]): Promise<IdrRates | null> {
  const foreign = [...new Set(currencies)].filter((c) => c !== "IDR");
  if (!foreign.length) return { date: "", toIdr: { IDR: 1 } };
  // EUR base keeps full precision; IDR as base rounds small rates (USD 5.5e-5).
  const symbols = [...new Set(["IDR", ...foreign])].filter((c) => c !== "EUR").join(",");
  try {
    const res = await fetch(`${ENDPOINT}?base=EUR&symbols=${symbols}`, { next: { revalidate: 6 * 60 * 60 } });
    if (!res.ok) return null;
    const body = (await res.json()) as { date: string; rates: Record<string, number> };
    const eurToIdr = body.rates.IDR;
    if (!eurToIdr) return null;
    const toIdr: Record<string, number> = { IDR: 1, EUR: eurToIdr };
    for (const c of foreign) if (c !== "EUR" && body.rates[c]) toIdr[c] = eurToIdr / body.rates[c]!;
    return { date: body.date, toIdr };
  } catch {
    return null;
  }
}

/**
 * IDR per unit of `currency` on `day`, for rates recorded with a document
 * (an invoice at issue, a payment proof when paid — Phase 2 · M9): Finance's
 * reference rate in effect that day, else today's ECB rate, else null.
 */
export async function rateToIdrOn(currency: string, day: IsoDate): Promise<number | null> {
  if (currency === "IDR") return 1;
  const ref = await prisma.fxReferenceRate.findFirst({
    where: { currency, effectiveFrom: { lte: parseIsoDate(day) } },
    orderBy: { effectiveFrom: "desc" },
    select: { rateToIdr: true },
  });
  if (ref) return numOr0(ref.rateToIdr);
  const live = await getIdrRates([currency]);
  const rate = live?.toIdr[currency];
  return rate ? Math.round(rate * 1_000_000) / 1_000_000 : null;
}

/**
 * Currency → IDR for estimates on dashboards (pipeline, receivables), as on
 * the C-Level dashboard: Finance's reference rate in effect, else today's
 * ECB rate. Missing currencies are left out (callers count them apart).
 */
export async function idrRateMap(tx: Pick<Tx, "fxReferenceRate">, currencies: string[], today: IsoDate): Promise<Map<string, number>> {
  const rates = new Map<string, number>();
  const ref = await tx.fxReferenceRate.findMany({ where: { effectiveFrom: { lte: parseIsoDate(today) } }, orderBy: { effectiveFrom: "desc" } });
  for (const r of ref) if (!rates.has(r.currency)) rates.set(r.currency, numOr0(r.rateToIdr));
  const missing = [...new Set(currencies)].filter((c) => c !== "IDR" && !rates.has(c));
  if (missing.length) {
    const live = await getIdrRates(missing);
    for (const c of missing) if (live?.toIdr[c]) rates.set(c, live.toIdr[c]!);
  }
  return rates;
}
