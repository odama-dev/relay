import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { numOr0 } from "@/lib/money";
import { notifyMany } from "@/lib/notify";
import { formatMoney } from "@/lib/format";
import { isoDate, todayIn } from "@/lib/time/pure";
import { deriveInvoiceStatus, fromMinor, fxRateToIdr, toMinor } from "@/lib/invoices/pure";
import type { XenditCallback } from "@/lib/xendit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function financeAndSales(invoiceCreatedBy: string | null): Promise<string[]> {
  const finance = await prisma.profile.findMany({ where: { role: "finance", status: "active" }, select: { id: true } });
  return [...finance.map((f) => f.id), ...(invoiceCreatedBy ? [invoiceCreatedBy] : [])];
}

/**
 * `invoices.amount_paid` = sum of the payments matched to the invoice; the
 * status follows from it and the due dates (Aturan turunan, M5.8).
 */
export async function refreshInvoice(invoiceId: string, today = todayIn()): Promise<{ status: string; becameOverdue: boolean }> {
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { payments: { select: { amount: true } }, paymentRequests: { select: { amount: true, status: true, dueDate: true } } },
  });
  const paid = fromMinor(
    inv.payments.reduce((s, p) => s + toMinor(numOr0(p.amount), inv.currency), 0),
    inv.currency,
  );
  const status = deriveInvoiceStatus(
    inv.status,
    numOr0(inv.total),
    paid,
    inv.paymentRequests.map((r) => ({ amount: numOr0(r.amount), status: r.status, dueDate: isoDate(r.dueDate) })),
    today,
    inv.currency,
  );
  await prisma.invoice.update({ where: { id: invoiceId }, data: { amountPaid: paid, status } });
  return { status, becameOverdue: status === "overdue" && inv.status !== "overdue" };
}

/**
 * Applies a payment to its request: the request becomes paid, the invoice is
 * refreshed, Sales and Finance hear about it (M5.6).
 */
async function applyToRequest(paymentId: string, requestId: string, matchedBy: string | null): Promise<void> {
  const request = await prisma.invoicePaymentRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { invoice: { select: { id: true, number: true, currency: true, createdBy: true, billToName: true, projectId: true } } },
  });
  const existing = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { amount: true } });
  // Paid amount differs from the request → Finance reviews it (M5.6).
  const mismatch = toMinor(numOr0(existing.amount), request.invoice.currency) !== toMinor(numOr0(request.amount), request.invoice.currency);
  const payment = await prisma.payment.update({
    where: { id: paymentId },
    data: { paymentRequestId: requestId, invoiceId: request.invoiceId, matchedBy, matchedAt: new Date(), needsReview: mismatch },
  });
  await prisma.invoicePaymentRequest.update({ where: { id: requestId }, data: { status: "paid", paidAt: payment.paidAt } });
  const { status } = await refreshInvoice(request.invoiceId);

  await notifyMany(await financeAndSales(request.invoice.createdBy), "payment_received", {
    title: `Payment received: ${request.invoice.number ?? "invoice"} · ${request.label}`,
    body: `${request.invoice.billToName} paid ${formatMoney(numOr0(payment.amount), payment.currency)} via ${payment.channel ?? "Xendit"}. Invoice is now ${status.replace("_", " ")}.${mismatch ? " Amount differs from the request — please review." : ""}`,
    path: `/invoices/${request.invoiceId}`,
    refId: payment.id,
  });
}

export type CallbackResult = { outcome: "recorded" | "duplicate" | "unmatched" | "expired" | "ignored" };

/**
 * Xendit invoice callback (M5.6). Idempotent: the Xendit transaction id is
 * unique on `payments`, so a re-delivered notification is a no-op.
 */
export async function handleXenditCallback(body: XenditCallback): Promise<CallbackResult> {
  const requestId = UUID.test(body.external_id ?? "") ? body.external_id : null;
  const request = requestId ? await prisma.invoicePaymentRequest.findUnique({ where: { id: requestId } }) : null;

  if (body.status === "EXPIRED") {
    if (request && request.status === "pending" && request.xenditInvoiceId === body.id) {
      await prisma.invoicePaymentRequest.update({ where: { id: request.id }, data: { status: "expired" } });
      return { outcome: "expired" };
    }
    return { outcome: "ignored" };
  }
  if (body.status !== "PAID" && body.status !== "SETTLED") return { outcome: "ignored" };

  const externalId = body.payment_id || body.id;
  const amount = body.paid_amount ?? body.amount ?? 0;
  const currency = body.currency ?? "IDR";
  const fee = body.fees_paid_amount ?? null;
  const settlementIdr =
    currency === "IDR"
      ? (body.adjusted_received_amount ?? (fee !== null ? amount - fee : amount))
      : body.settlement_currency === "IDR" && body.settlement_amount != null
        ? body.settlement_amount
        : null;

  let paymentId: string;
  try {
    const p = await prisma.payment.create({
      data: {
        externalId,
        amount,
        currency,
        paidAt: body.paid_at ? new Date(body.paid_at) : new Date(),
        channel: body.payment_channel ?? body.payment_method ?? null,
        feeAmount: fee,
        netAmount: fee !== null ? amount - fee : null,
        settlementAmountIdr: settlementIdr,
        fxRateToIdr: fxRateToIdr(settlementIdr, amount, currency),
        raw: body as unknown as Prisma.InputJsonValue,
      },
    });
    paymentId = p.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { outcome: "duplicate" };
    throw err;
  }

  if (!request || request.status === "void") {
    // M5.7 — unmatched: Finance matches it by hand.
    const finance = await prisma.profile.findMany({ where: { role: "finance", status: "active" }, select: { id: true } });
    await notifyMany(finance.map((f) => f.id), "payment_unmatched", {
      title: "A Xendit payment couldn't be matched",
      body: `${formatMoney(amount, currency)} · reference ${body.external_id}. Match it to an invoice in Payments.`,
      path: "/payments",
      refId: paymentId,
    });
    return { outcome: "unmatched" };
  }

  await applyToRequest(paymentId, request.id, null);
  return { outcome: "recorded" };
}

/** M5.7 — Finance matches an unmatched payment to a payment request by hand. */
export async function matchPayment(paymentId: string, requestId: string, userId: string): Promise<void> {
  await applyToRequest(paymentId, requestId, userId);
}

/**
 * M5.8 daily job — refreshes every open invoice's status; Sales and Finance
 * get a DM on the first overdue day, then a weekly reminder while it stays
 * overdue. Idempotent.
 */
export async function checkOverdueInvoices(today = todayIn()): Promise<{ checked: number; notified: number }> {
  const open = await prisma.invoice.findMany({
    where: { status: { in: ["sent", "partially_paid", "overdue"] } },
    select: { id: true, number: true, billToName: true, currency: true, total: true, amountPaid: true, createdBy: true, overdueNotifiedAt: true },
  });
  let notified = 0;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000 + 3_600_000); // a little slack for job drift
  for (const inv of open) {
    const { status, becameOverdue } = await refreshInvoice(inv.id, today);
    if (status !== "overdue") continue;
    const due = becameOverdue || !inv.overdueNotifiedAt || inv.overdueNotifiedAt < weekAgo;
    if (!due) continue;
    await notifyMany(await financeAndSales(inv.createdBy), "invoice_overdue", {
      title: `${becameOverdue || !inv.overdueNotifiedAt ? "Invoice overdue" : "Still overdue"}: ${inv.number ?? "invoice"}`,
      body: `${inv.billToName} · ${formatMoney(numOr0(inv.total) - numOr0(inv.amountPaid), inv.currency)} outstanding.`,
      path: `/invoices/${inv.id}`,
      refId: inv.id,
    });
    await prisma.invoice.update({ where: { id: inv.id }, data: { overdueNotifiedAt: new Date() } });
    notified++;
  }
  return { checked: open.length, notified };
}
