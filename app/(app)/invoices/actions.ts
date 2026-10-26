"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser, requireUser } from "@/lib/auth";
import { run, fail, parseOrFail, type ActionResult } from "@/lib/actions";
import type { Tx } from "@/lib/db";
import { logActivity } from "@/lib/audit";
import { perms } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { parseIsoDate } from "@/lib/time/pure";
import { invoiceTotal, itemAmount, requestsMatchTotal } from "@/lib/invoices/pure";
import { ensurePaymentLinks, sendInvoice } from "@/lib/invoices/issue";
import { matchPayment, proofRejected, proofVerified, refreshInvoice } from "@/lib/invoices/payments";
import { invoiceSchema, manualInvoiceStatus, proofDecisionSchema, sendInvoiceSchema, uuid } from "@/lib/validation";

const FORBIDDEN = "Only Sales and Finance manage invoices.";

function revalidateInvoice(id?: string, projectId?: string) {
  revalidatePath("/invoices");
  revalidatePath("/payments");
  if (id) revalidatePath(`/invoices/${id}`);
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

async function writeLines(tx: Tx, invoiceId: string, d: z.output<typeof invoiceSchema>, currency: string) {
  await tx.invoiceItem.deleteMany({ where: { invoiceId } });
  await tx.invoicePaymentRequest.deleteMany({ where: { invoiceId } });
  await tx.invoiceItem.createMany({
    data: d.items.map((it, position) => ({ invoiceId, description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, amount: itemAmount(it, currency), position })),
  });
  await tx.invoicePaymentRequest.createMany({
    data: d.requests.map((r, position) => ({ invoiceId, label: r.label, amount: r.amount, dueDate: parseIsoDate(r.dueDate), position })),
  });
}

function checkTotals(d: z.output<typeof invoiceSchema>, currency: string): number {
  const total = invoiceTotal(d.items, currency);
  if (total <= 0) fail("The invoice total must be more than zero.");
  if (!requestsMatchTotal(total, d.requests.map((r) => r.amount), currency)) fail("The payment requests must add up to the invoice total.");
  return total;
}

/** M5.1 — a draft invoice for a client project. Currency and bill-to start from the project and client; Sales may change them. */
export async function createInvoice(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await requireUser();
    if (!perms.editInvoices(user)) fail(FORBIDDEN);
    const d = parseOrFail(invoiceSchema, raw);
    const invoice = await asUser(user, async (tx) => {
      const project = await tx.project.findUnique({ where: { id: d.projectId }, include: { client: true } });
      if (!project) fail("Project not found.");
      if (project.kind !== "client" || !project.client) fail("Internal projects aren't invoiced.");
      if (project.status !== "active" && project.status !== "on_hold") fail("Invoices are only created for Active or On hold projects.");
      const total = checkTotals(d, d.currency);
      const inv = await tx.invoice.create({
        data: {
          projectId: project.id,
          clientId: project.client.id,
          currency: d.currency,
          issueDate: parseIsoDate(d.issueDate),
          notes: d.notes ?? null,
          kind: d.kind,
          platform: d.platform,
          billToName: d.billToName,
          billToAddress: d.billToAddress ?? null,
          billToEmail: d.billToEmail ?? null,
          subtotal: total,
          total,
          createdBy: user.id,
        },
      });
      await writeLines(tx, inv.id, d, d.currency);
      return inv;
    });
    await logActivity({ actorId: user.id, entityType: "invoice", entityId: invoice.id, action: "created" });
    revalidateInvoice(invoice.id, invoice.projectId);
    return { id: invoice.id };
  });
}

/** Drafts can be edited; once sent, items and requests are locked (DB-enforced). */
export async function updateInvoice(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const invoiceId = parseOrFail(uuid, id);
    const d = parseOrFail(invoiceSchema, raw);
    const projectId = await asUser(user, async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!inv) fail("Invoice not found.");
      if (inv.status !== "draft") fail("A sent invoice is locked. Void it and create a new one.");
      const total = checkTotals(d, d.currency);
      const res = await tx.invoice.updateMany({
        where: { id: invoiceId },
        data: {
          issueDate: parseIsoDate(d.issueDate),
          currency: d.currency,
          billToName: d.billToName,
          billToAddress: d.billToAddress ?? null,
          billToEmail: d.billToEmail ?? null,
          notes: d.notes ?? null,
          kind: d.kind,
          platform: d.platform,
          subtotal: total,
          total,
        },
      });
      if (res.count === 0) fail(FORBIDDEN);
      await writeLines(tx, invoiceId, d, d.currency);
      return inv.projectId;
    });
    await logActivity({ actorId: user.id, entityType: "invoice", entityId: invoiceId, action: "updated" });
    revalidateInvoice(invoiceId, projectId);
  });
}

export async function deleteInvoice(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const invoiceId = parseOrFail(uuid, id);
    const projectId = await asUser(user, async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { projectId: true, number: true } });
      if (!inv) fail("Invoice not found.");
      // A draft that already took a number (a failed send) is voided instead, so the number isn't lost.
      if (inv.number) fail("This draft already has a number. Void it instead.");
      const res = await tx.invoice.deleteMany({ where: { id: invoiceId, status: "draft" } });
      if (res.count === 0) fail("Only drafts can be deleted.");
      return inv.projectId;
    });
    await logActivity({ actorId: user.id, entityType: "invoice", entityId: invoiceId, action: "deleted" });
    revalidateInvoice(undefined, projectId);
  });
}

/** M5.5 — send (or resend) the invoice with its PDF and payment links. */
export async function sendInvoiceToClient(id: unknown, raw: unknown): Promise<ActionResult<{ number: string }>> {
  return run(async () => {
    const user = await requireUser();
    const invoiceId = parseOrFail(uuid, id);
    const d = parseOrFail(sendInvoiceSchema, raw);
    // Permission under RLS: the invoice is visible and the database grants
    // this user invoice edits (Sales / Finance — invoices_update policy).
    const inv = await asUser(user, async (tx) => {
      const found = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { projectId: true, status: true } });
      if (!found) fail("Invoice not found.");
      const [row] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT app.has_role('sales', 'finance') AS ok`;
      if (!row?.ok) fail(FORBIDDEN);
      return found;
    });
    const res = await sendInvoice(invoiceId, { ...d, sentBy: user.id });
    await logActivity({ actorId: user.id, entityType: "invoice", entityId: invoiceId, action: "sent", metadata: { to: d.to } });
    revalidateInvoice(invoiceId, inv.projectId);
    return res;
  });
}

/**
 * A status set by hand on an issued invoice (Sales / Finance), or `null` to
 * go back to the one derived from payments and due dates. The database keeps
 * the manual one until it's cleared (invoices_guard).
 */
export async function setInvoiceStatus(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const invoiceId = parseOrFail(uuid, id);
    const status = parseOrFail(manualInvoiceStatus, raw);
    const inv = await asUser(user, async (tx) => {
      const found = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { projectId: true, status: true } });
      if (!found) fail("Invoice not found.");
      const res = await tx.invoice.updateMany({ where: { id: invoiceId }, data: { statusOverride: status } });
      if (res.count === 0) fail(FORBIDDEN);
      return found;
    });
    // Back to automatic: derive it again from the payments.
    if (status === null) await refreshInvoice(invoiceId);
    await logActivity({ actorId: user.id, entityType: "invoice", entityId: invoiceId, action: "status_set", metadata: { from: inv.status, to: status ?? "automatic" } });
    revalidateInvoice(invoiceId, inv.projectId);
    revalidatePath("/dashboard");
  });
}

/** Void: the number is never reused (M5.2). Unpaid requests are voided too. */
export async function voidInvoice(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const invoiceId = parseOrFail(uuid, id);
    const projectId = await asUser(user, async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { projectId: true, status: true } });
      if (!inv) fail("Invoice not found.");
      if (inv.status === "draft") fail("Delete the draft instead.");
      await tx.invoice.update({ where: { id: invoiceId }, data: { status: "void" } });
      return inv.projectId;
    });
    await prisma.invoicePaymentRequest.updateMany({ where: { invoiceId, status: { in: ["pending", "expired"] } }, data: { status: "void" } });
    await logActivity({ actorId: user.id, entityType: "invoice", entityId: invoiceId, action: "voided" });
    revalidateInvoice(invoiceId, projectId);
  });
}

/** M5.4 — a new Xendit link for an expired request, without changing the invoice. */
export async function regeneratePaymentLink(invoiceId: unknown, requestId: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    if (!perms.editInvoices(user)) fail(FORBIDDEN);
    const iid = parseOrFail(uuid, invoiceId);
    const rid = parseOrFail(uuid, requestId);
    const req = await asUser(user, (tx) => tx.invoicePaymentRequest.findFirst({ where: { id: rid, invoiceId: iid }, include: { invoice: { select: { status: true } } } }));
    if (!req) fail("Payment request not found.");
    if (req.invoice.status === "draft" || req.invoice.status === "void") fail("Only sent invoices have payment links.");
    if (req.status === "paid") fail("This request is already paid.");
    await ensurePaymentLinks(iid, { renew: rid });
    await logActivity({ actorId: user.id, entityType: "invoice", entityId: iid, action: "link_regenerated", metadata: { requestId: rid } });
    revalidateInvoice(iid);
  });
}

/** M5.7 — Finance matches an unmatched Xendit payment to a payment request. */
export async function matchPaymentToRequest(paymentId: unknown, requestId: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const pid = parseOrFail(uuid, paymentId);
    const rid = parseOrFail(uuid, requestId);
    // RLS proves Finance: only Finance may update payments.
    const ok = await asUser(user, async (tx) => {
      const res = await tx.payment.updateMany({ where: { id: pid, invoiceId: null }, data: { matchedBy: user.id } });
      const req = await tx.invoicePaymentRequest.findUnique({ where: { id: rid }, select: { status: true } });
      return res.count > 0 && req !== null && req.status !== "paid" && req.status !== "void";
    });
    if (!ok) fail("Only Finance can match payments, to a request that's still open.");
    await matchPayment(pid, rid, user.id);
    await logActivity({ actorId: user.id, entityType: "payment", entityId: pid, action: "matched", metadata: { requestId: rid } });
    revalidateInvoice();
  });
}

/** Recompute status now (e.g. after editing due dates). */
export async function refreshInvoiceStatus(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const invoiceId = parseOrFail(uuid, id);
    const visible = await asUser(user, (tx) => tx.invoice.count({ where: { id: invoiceId } }));
    if (!visible) fail("Invoice not found.");
    await refreshInvoice(invoiceId);
    revalidateInvoice(invoiceId);
  });
}

/**
 * Phase 2 · M9 — Finance verifies a payment proof (it becomes a payment and
 * counts as revenue) or rejects it with a note (the invoice goes back to
 * Sent / Overdue). RLS: Finance module, never the person who submitted it.
 */
export async function decidePaymentProof(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const proofId = parseOrFail(uuid, id);
    const d = parseOrFail(proofDecisionSchema, raw);
    const proof = await asUser(user, async (tx) => {
      const p = await tx.paymentProof.findUnique({ where: { id: proofId }, select: { invoiceId: true, invoice: { select: { projectId: true } } } });
      if (!p) fail("Proof not found.");
      await tx.paymentProof.update({
        where: { id: proofId },
        data: { status: d.verify ? "verified" : "rejected", reviewNote: d.note ?? null, ...(d.fxRateToIdr !== null ? { fxRateToIdr: d.fxRateToIdr } : {}) },
      });
      return p;
    });
    if (d.verify) await proofVerified(proofId, user.id);
    else await proofRejected(proofId);
    await logActivity({ actorId: user.id, entityType: "invoice", entityId: proof.invoiceId, action: d.verify ? "proof_verified" : "proof_rejected", metadata: { proofId, note: d.note } });
    revalidateInvoice(proof.invoiceId, proof.invoice.projectId);
  });
}
