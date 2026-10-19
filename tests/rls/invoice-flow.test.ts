/**
 * M5 definition of done, minus the PDF and email (covered in the app):
 * an invoice with two payment requests is issued, paid through Xendit
 * callbacks, and ends Paid — numbered in sequence, no double payments.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { issueInvoice } from "@/lib/invoices/issue";
import { checkOverdueInvoices, handleXenditCallback } from "@/lib/invoices/payments";
import { verifyCallbackToken } from "@/lib/xendit";

const salesId = randomUUID();
let projectId: string;
let clientId: string;

async function draft(total: number, dueDays: [number, number]) {
  const day = (n: number) => new Date(Date.UTC(2026, 9, 13 + n));
  return prisma.invoice.create({
    data: {
      projectId,
      clientId,
      currency: "USD",
      issueDate: day(0),
      billToName: "Flow Client",
      total,
      subtotal: total,
      createdBy: salesId,
      items: { create: [{ description: "Work", quantity: 1, unitPrice: total, amount: total }] },
      paymentRequests: {
        create: [
          { label: "DP 50%", amount: total / 2, dueDate: day(dueDays[0]), position: 0 },
          { label: "Pelunasan", amount: total / 2, dueDate: day(dueDays[1]), position: 1 },
        ],
      },
    },
    include: { paymentRequests: { orderBy: { position: "asc" } } },
  });
}

const paid = (requestId: string, xenditId: string, paymentId: string, amount: number) =>
  handleXenditCallback({
    id: xenditId,
    external_id: requestId,
    status: "PAID",
    paid_amount: amount,
    currency: "USD",
    paid_at: "2026-10-14T03:00:00Z",
    payment_id: paymentId,
    payment_channel: "CREDIT_CARD",
    fees_paid_amount: 10,
    settlement_currency: "IDR",
    settlement_amount: amount * 16_000,
  });

beforeAll(async () => {
  await prisma.profile.create({ data: { id: salesId, email: `sales-${salesId}@flow.test`, fullName: "Flow Sales", role: "sales", status: "active" } });
  const pm = await prisma.profile.create({ data: { id: randomUUID(), email: `pm-${salesId}@flow.test`, fullName: "Flow PM", role: "pm", status: "active" } });
  const client = await prisma.client.create({ data: { code: "FLOW", name: `Flow ${salesId}` } });
  clientId = client.id;
  const project = await prisma.project.create({
    data: { name: "Flow", kind: "client", clientId, contractType: "fixed", currency: "USD", pmId: pm.id, startDate: new Date("2026-10-01") },
  });
  projectId = project.id;
});

afterAll(() => prisma.$disconnect());

describe("invoice → Xendit → paid", () => {
  it("issues numbers in sequence and one link per request", async () => {
    const a = await draft(1000, [7, 30]);
    const b = await draft(500, [7, 30]);
    const na = await issueInvoice(a.id);
    const nb = await issueInvoice(b.id);
    expect(na).toMatch(/^ODAMA\/26\/\d{4}$/);
    expect(Number(nb.slice(-4))).toBe(Number(na.slice(-4)) + 1);
    // Issuing again keeps the number.
    expect(await issueInvoice(a.id)).toBe(na);
    const links = await prisma.invoicePaymentRequest.findMany({ where: { invoiceId: a.id } });
    expect(links.every((l) => l.xenditInvoiceId && l.xenditUrl)).toBe(true);
  });

  it("goes Partially paid → Paid, records each payment once, links it to the project", async () => {
    const inv = await draft(2000, [7, 30]);
    await issueInvoice(inv.id);
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: "sent" } });
    const [dp, rest] = inv.paymentRequests;

    expect(await paid(dp!.id, "xi_1", `pay_dp_${inv.id}`, 1000)).toEqual({ outcome: "recorded" });
    expect(await paid(dp!.id, "xi_1", `pay_dp_${inv.id}`, 1000)).toEqual({ outcome: "duplicate" });
    let state = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(state.status).toBe("partially_paid");
    expect(state.amountPaid.toNumber()).toBe(1000);

    expect(await paid(rest!.id, "xi_2", `pay_rest_${inv.id}`, 1000)).toEqual({ outcome: "recorded" });
    state = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(state.status).toBe("paid");

    const payments = await prisma.payment.findMany({ where: { invoiceId: inv.id }, include: { invoice: { select: { projectId: true } } } });
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => p.invoice?.projectId === projectId)).toBe(true);
    expect(payments[0]!.fxRateToIdr?.toNumber()).toBe(16_000);
    expect(payments[0]!.netAmount?.toNumber()).toBe(990);
  });

  it("flags a payment whose amount differs from the request", async () => {
    const inv = await draft(800, [7, 30]);
    await issueInvoice(inv.id);
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: "sent" } });
    await paid(inv.paymentRequests[0]!.id, "xi_3", `pay_short_${inv.id}`, 350);
    const p = await prisma.payment.findUniqueOrThrow({ where: { externalId: `pay_short_${inv.id}` } });
    expect(p.needsReview).toBe(true);
  });

  it("queues payments with no matching request as unmatched", async () => {
    expect(await paid(randomUUID(), "xi_x", `pay_orphan_${salesId}`, 10)).toEqual({ outcome: "unmatched" });
    const p = await prisma.payment.findUniqueOrThrow({ where: { externalId: `pay_orphan_${salesId}` } });
    expect(p.invoiceId).toBeNull();
  });

  it("turns Overdue once a request is past due, and back when paid", async () => {
    const inv = await draft(600, [-3, 30]);
    await issueInvoice(inv.id);
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: "sent" } });
    await checkOverdueInvoices("2026-10-13");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("overdue");
    await paid(inv.paymentRequests[0]!.id, "xi_4", `pay_late_${inv.id}`, 300);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("partially_paid");
  });

  it("refuses webhooks without the right callback token", () => {
    const token = process.env.XENDIT_CALLBACK_TOKEN;
    expect(verifyCallbackToken(null)).toBe(false);
    expect(verifyCallbackToken("wrong-token")).toBe(false);
    if (token) expect(verifyCallbackToken(token)).toBe(true);
  });
});
