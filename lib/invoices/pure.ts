import type { InvoiceKind, InvoiceStatus, PaymentPlatform, PaymentRequestStatus } from "@prisma/client";
import { currencyDecimals } from "@/lib/format";
import type { IsoDate } from "@/lib/time/pure";

/**
 * Invoice math (PRD M5). Amounts are computed in integer minor units of the
 * invoice currency so sums never drift (no float money), then returned as
 * plain decimals for numeric(18,2) columns.
 */

const scale = (currency: string) => 10 ** currencyDecimals(currency);
export const toMinor = (amount: number, currency: string) => Math.round(amount * scale(currency));
export const fromMinor = (minor: number, currency: string) => minor / scale(currency);

export type ItemInput = { description: string; quantity: number; unitPrice: number };

export function itemAmount(item: Pick<ItemInput, "quantity" | "unitPrice">, currency: string): number {
  return fromMinor(Math.round(item.quantity * toMinor(item.unitPrice, currency)), currency);
}

/** Total = sum of all items; no tax in Phase 1. */
export function invoiceTotal(items: Pick<ItemInput, "quantity" | "unitPrice">[], currency: string): number {
  const minor = items.reduce((sum, item) => sum + toMinor(itemAmount(item, currency), currency), 0);
  return fromMinor(minor, currency);
}

/**
 * Splits a total by percentages ("Down Payment" 50%, "Final Payment" 50%). Rounding is
 * settled on the last request so the parts always add up to the total.
 */
export function splitByPercent(total: number, percents: number[], currency: string): number[] {
  const totalMinor = toMinor(total, currency);
  const parts = percents.map((p) => Math.round((totalMinor * p) / 100));
  const drift = totalMinor - parts.reduce((a, b) => a + b, 0);
  if (parts.length > 0) parts[parts.length - 1]! += drift;
  return parts.map((m) => fromMinor(m, currency));
}

/** A request's share of the invoice as a whole percent ("Down Payment (50%)"), to one decimal when it isn't whole. */
export function requestPercent(amount: number, total: number, currency: string): number {
  const totalMinor = toMinor(total, currency);
  if (totalMinor <= 0) return 0;
  return Math.round((toMinor(amount, currency) * 1000) / totalMinor) / 10;
}

/** "The sum of all payment requests must equal the invoice total" (Aturan turunan). */
export function requestsMatchTotal(total: number, amounts: number[], currency: string): boolean {
  return amounts.reduce((sum, a) => sum + toMinor(a, currency), 0) === toMinor(total, currency);
}

/** `ODAMA/{YY}/{SEQ}` → ODAMA/26/0001 (M5.2). {YYYY} is also understood. */
export function formatInvoiceNumber(format: string, year: number, seq: number): string {
  return format
    .replace("{YYYY}", String(year))
    .replace("{YY}", String(year % 100).padStart(2, "0"))
    .replace("{SEQ}", String(seq).padStart(4, "0"));
}

export type RequestState = { amount: number; status: PaymentRequestStatus; dueDate: IsoDate };

/**
 * Status of an issued invoice from its payments (M5.6, M5.8):
 * Paid once fully paid; otherwise Payment submitted while a proof waits for
 * Finance (Phase 2 · M9); otherwise Overdue while any unpaid request is past
 * due; otherwise Partially paid / Sent. Draft and Void never change here.
 */
export function deriveInvoiceStatus(
  current: InvoiceStatus,
  total: number,
  amountPaid: number,
  requests: RequestState[],
  today: IsoDate,
  currency: string,
  proofPending = false,
): InvoiceStatus {
  if (current === "draft" || current === "void") return current;
  if (toMinor(amountPaid, currency) >= toMinor(total, currency) && total > 0) return "paid";
  if (proofPending) return "payment_submitted";
  const overdue = requests.some((r) => r.status !== "paid" && r.status !== "void" && r.dueDate < today);
  if (overdue) return "overdue";
  return amountPaid > 0 ? "partially_paid" : "sent";
}

/** IDR received per unit of invoice currency (M5.6 "Kurs"). */
export function fxRateToIdr(settlementIdr: number | null, amount: number, currency: string): number | null {
  if (currency === "IDR") return 1;
  if (settlementIdr == null || amount <= 0) return null;
  return Math.round((settlementIdr / amount) * 1_000_000) / 1_000_000;
}

/**
 * Per-currency amounts summed into IDR at indicative rates (whole rupiah).
 * Null when any currency has no rate: a partial total would read as complete.
 */
export function normalizeToIdr(amounts: { currency: string; amount: number }[], toIdr: Record<string, number>): number | null {
  let idr = 0;
  for (const { currency, amount } of amounts) {
    const rate = currency === "IDR" ? 1 : toIdr[currency];
    if (!rate) return null;
    idr += Math.round(amount * rate);
  }
  return idr;
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_paid: "Partially paid",
  payment_submitted: "Payment submitted",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

/** Phase 2 · M9 — how the client pays, and which bill this is. */
export const PLATFORM_LABELS: Record<PaymentPlatform, string> = {
  xendit: "Xendit",
  bank_transfer: "Bank transfer",
  wise: "Wise",
  paypal: "PayPal",
  other: "Other",
};

export const INVOICE_KIND_LABELS: Record<InvoiceKind, string> = { dp: "Down payment", term: "Term", final: "Final" };
