import "server-only";
import { prisma } from "@/lib/prisma";
import { numOr0 } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { createPaymentLink } from "@/lib/xendit";
import { putFile, getFile } from "@/lib/storage";
import { renderEmail, sendMail } from "@/lib/mail";
import { formatDate, formatMoney } from "@/lib/format";
import { formatInvoiceNumber, requestsMatchTotal } from "@/lib/invoices/pure";
import { renderInvoicePdf } from "@/lib/invoices/pdf";
import { refreshInvoice } from "@/lib/invoices/payments";
import { ActionError } from "@/lib/actions";

/**
 * The system half of "Send to client" (M5.2–M5.5). The caller has already
 * proved under RLS that the user may edit this invoice.
 */

/** M5.2 — the number is taken from the yearly sequence once; a retry reuses it. */
async function ensureNumber(invoiceId: string): Promise<string> {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { number: true, issueDate: true } });
  if (inv.number) return inv.number;
  const settings = await getSettings();
  const year = inv.issueDate.getUTCFullYear();
  // A number that already exists (e.g. issued before Odama OS, or set by
  // hand) is skipped, never reused.
  for (let attempt = 0; attempt < 50; attempt++) {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`SELECT app.next_invoice_number(${year}::int) AS n`;
    const number = formatInvoiceNumber(settings.invoice_number_format, year, row!.n);
    if (await prisma.invoice.findUnique({ where: { number }, select: { id: true } })) continue;
    // Only set it if no concurrent send already did.
    await prisma.invoice.updateMany({ where: { id: invoiceId, number: null }, data: { number } });
    return (await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { number: true } })).number!;
  }
  throw new ActionError("Couldn't find a free invoice number. Check the number format in Settings.");
}

const LINK_DURATION_DAYS = 60;

/** M5.4 — one Xendit link per payment request that doesn't have a live one. */
export async function ensurePaymentLinks(invoiceId: string, opts: { renew?: string } = {}): Promise<void> {
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { paymentRequests: true, project: { select: { code: true } } },
  });
  for (const r of inv.paymentRequests) {
    const renew = opts.renew === r.id;
    if (r.status === "paid" || r.status === "void") continue;
    if (r.xenditInvoiceId && r.status === "pending" && !renew) continue;
    // Due date + a grace period, at least 7 days from now.
    const until = Math.max(r.dueDate.getTime() + LINK_DURATION_DAYS * 86_400_000, Date.now() + 7 * 86_400_000);
    const link = await createPaymentLink({
      externalId: r.id,
      amount: numOr0(r.amount),
      currency: inv.currency,
      description: `${inv.number ?? "Invoice"} · ${r.label} · ${inv.project.code}`,
      payerEmail: inv.billToEmail,
      durationSeconds: Math.round((until - Date.now()) / 1000),
    });
    await prisma.invoicePaymentRequest.update({
      where: { id: r.id },
      data: { xenditInvoiceId: link.id, xenditUrl: link.url, xenditExpiresAt: link.expiresAt, status: "pending" },
    });
  }
}

/** M5.3 — renders and stores the PDF; returns the file. */
export async function storePdf(invoiceId: string): Promise<{ pdf: Buffer; filename: string }> {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { number: true } });
  const pdf = await renderInvoicePdf(invoiceId);
  const filename = `${(inv.number ?? "draft").replace(/[^A-Za-z0-9_-]+/g, "-")}.pdf`;
  const key = `${invoiceId}/${filename}`;
  await putFile("invoices", key, pdf, "application/pdf");
  await prisma.invoice.update({ where: { id: invoiceId }, data: { pdfPath: key } });
  return { pdf, filename };
}

export async function storedPdf(invoiceId: string): Promise<{ pdf: Buffer; filename: string } | null> {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { pdfPath: true } });
  if (!inv?.pdfPath) return null;
  const pdf = await getFile("invoices", inv.pdfPath);
  return pdf ? { pdf, filename: inv.pdfPath.split("/").pop()! } : null;
}

/** Number + payment links: everything an invoice needs before its PDF is printed. */
export async function issueInvoice(invoiceId: string): Promise<string> {
  const number = await ensureNumber(invoiceId);
  await ensurePaymentLinks(invoiceId);
  return number;
}

export type SendInput = { to: string[]; cc: string[]; subject: string; message: string; sentBy: string };

/**
 * Send to client (M5.5): number → payment links → PDF → email via Resend.
 * The first successful send moves Draft → Sent. A failed send is recorded and
 * leaves the status unchanged so it can be retried.
 */
export async function sendInvoice(invoiceId: string, input: SendInput): Promise<{ number: string }> {
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { paymentRequests: { orderBy: { position: "asc" } }, items: true },
  });
  if (inv.status === "void") throw new ActionError("A void invoice can't be sent.");
  if (inv.items.length === 0) throw new ActionError("Add at least one item first.");
  if (!requestsMatchTotal(numOr0(inv.total), inv.paymentRequests.map((r) => numOr0(r.amount)), inv.currency)) {
    throw new ActionError("The payment requests must add up to the invoice total.");
  }

  const number = await issueInvoice(invoiceId);
  const { pdf, filename } = await storePdf(invoiceId);

  const settings = await getSettings();
  const requests = await prisma.invoicePaymentRequest.findMany({ where: { invoiceId }, orderBy: { position: "asc" } });
  const lines = requests
    .filter((r) => r.status !== "paid" && r.status !== "void")
    .map((r) => `${r.label}: ${formatMoney(numOr0(r.amount), inv.currency)}, due ${formatDate(r.dueDate)}${r.xenditUrl ? ` — pay online: ${r.xenditUrl}` : ""}`);
  const { html, text } = renderEmail({
    heading: `Invoice ${number}`,
    paragraphs: [...input.message.split(/\n{2,}/).filter(Boolean), ...lines, "The invoice is attached as a PDF."],
    action: requests.find((r) => r.status === "pending" && r.xenditUrl)
      ? { label: "Pay online", url: requests.find((r) => r.status === "pending" && r.xenditUrl)!.xenditUrl! }
      : undefined,
    footer: settings.studio_profile.name,
  });

  const res = await sendMail({
    from: `${settings.invoice_sender_name} <${settings.invoice_sender_email}>`,
    replyTo: settings.invoice_sender_email,
    to: input.to,
    cc: input.cc,
    subject: input.subject.replaceAll("{number}", number),
    html,
    text,
    attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
  });

  await prisma.invoiceDelivery.create({
    data: {
      invoiceId,
      toEmails: input.to,
      ccEmails: input.cc,
      subject: input.subject.replaceAll("{number}", number),
      sentBy: input.sentBy,
      status: res.ok ? "sent" : "failed",
      resendMessageId: res.ok ? res.id : null,
      error: res.ok ? null : res.error,
    },
  });
  if (!res.ok) throw new ActionError(`The email wasn't sent: ${res.error}. Nothing changed — try again.`);

  if (inv.status === "draft") {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: "sent", sentAt: new Date() } });
    await refreshInvoice(invoiceId);
  }
  return { number };
}
