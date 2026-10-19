import "server-only";
import type { InvoiceStatus, PaymentRequestStatus, Prisma } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { num, numOr0 } from "@/lib/money";
import { perms } from "@/lib/roles";
import { isoDate, isIsoDate, parseIsoDate, todayIn, type IsoDate } from "@/lib/time/pure";
import { CURRENCIES } from "@/lib/validation";

export const INVOICE_STATUSES: InvoiceStatus[] = ["draft", "sent", "partially_paid", "paid", "overdue", "void"];

export type InvoiceFilters = {
  q?: string;
  status?: InvoiceStatus;
  clientId?: string;
  projectId?: string;
  currency?: string;
  from?: IsoDate;
  to?: IsoDate;
};

export function parseInvoiceFilters(sp: Record<string, string | string[] | undefined>): InvoiceFilters {
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const status = get("status");
  const currency = get("currency");
  return {
    q: get("q")?.trim() || undefined,
    status: INVOICE_STATUSES.includes(status as InvoiceStatus) ? (status as InvoiceStatus) : undefined,
    clientId: get("client"),
    projectId: get("project"),
    currency: (CURRENCIES as readonly string[]).includes(currency ?? "") ? currency : undefined,
    from: isIsoDate(get("from")) ? get("from") : undefined,
    to: isIsoDate(get("to")) ? get("to") : undefined,
  };
}

export type InvoiceRow = {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  client: { id: string; name: string };
  project: { id: string; code: string; name: string };
  currency: string;
  total: number;
  amountPaid: number;
  outstanding: number;
  issueDate: IsoDate;
  /** Payment requests (installments), e.g. "Down Payment · Final Payment". */
  terms: { label: string; status: PaymentRequestStatus }[];
  /** Earliest due date of an unpaid request. */
  nextDue: IsoDate | null;
};

/** M5.9 — invoices the viewer may see (RLS), newest first. */
export async function listInvoices(user: CurrentUser, f: InvoiceFilters): Promise<InvoiceRow[]> {
  const where: Prisma.InvoiceWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.clientId ? { clientId: f.clientId } : {}),
    ...(f.projectId ? { projectId: f.projectId } : {}),
    ...(f.currency ? { currency: f.currency } : {}),
    ...(f.from || f.to ? { issueDate: { ...(f.from ? { gte: parseIsoDate(f.from) } : {}), ...(f.to ? { lte: parseIsoDate(f.to) } : {}) } } : {}),
    ...(f.q
      ? {
          OR: [
            { number: { contains: f.q, mode: "insensitive" } },
            { billToName: { contains: f.q, mode: "insensitive" } },
            { project: { code: { contains: f.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const rows = await asUser(user, (tx) =>
    tx.invoice.findMany({
      where,
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, code: true, name: true } },
        paymentRequests: { orderBy: { position: "asc" }, select: { label: true, status: true, dueDate: true } },
      },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    }),
  );
  return rows.map((i) => {
    const total = numOr0(i.total);
    const paid = numOr0(i.amountPaid);
    const unpaid = i.paymentRequests.filter((r) => r.status !== "paid" && r.status !== "void");
    return {
      id: i.id,
      number: i.number,
      status: i.status,
      client: i.client,
      project: i.project,
      currency: i.currency,
      total,
      amountPaid: paid,
      outstanding: i.status === "void" || i.status === "draft" ? 0 : Math.max(0, total - paid),
      issueDate: isoDate(i.issueDate),
      terms: i.paymentRequests.map((r) => ({ label: r.label, status: r.status })),
      nextDue: unpaid.length ? isoDate(unpaid.map((r) => r.dueDate).sort((a, b) => a.getTime() - b.getTime())[0]!) : null,
    };
  });
}

/** Top of the invoice list (M5.9): outstanding per currency and the overdue count. */
export function summarize(rows: InvoiceRow[]) {
  const outstanding = new Map<string, number>();
  for (const r of rows) if (r.outstanding > 0) outstanding.set(r.currency, (outstanding.get(r.currency) ?? 0) + r.outstanding);
  return {
    outstanding: [...outstanding].map(([currency, amount]) => ({ currency, amount })),
    overdue: rows.filter((r) => r.status === "overdue").length,
  };
}

/** One invoice with everything the detail page shows; null if not visible. */
export async function getInvoice(user: CurrentUser, id: string) {
  const inv = await asUser(user, (tx) =>
    tx.invoice.findUnique({
      where: { id },
      include: {
        client: { include: { contacts: { where: { isPrimary: true } } } },
        project: { select: { id: true, code: true, name: true, status: true } },
        items: { orderBy: { position: "asc" } },
        paymentRequests: { orderBy: { position: "asc" } },
        deliveries: { orderBy: { sentAt: "desc" }, include: { sender: { select: { fullName: true } } } },
        payments: { orderBy: { paidAt: "asc" } },
        creator: { select: { fullName: true } },
      },
    }),
  );
  if (!inv) return null;
  const editable = perms.editInvoices(user);
  const total = numOr0(inv.total);
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    currency: inv.currency,
    issueDate: isoDate(inv.issueDate),
    notes: inv.notes,
    billTo: { name: inv.billToName, address: inv.billToAddress, email: inv.billToEmail },
    client: { id: inv.client.id, name: inv.client.name, billingEmail: inv.client.billingEmail, primaryEmail: inv.client.contacts[0]?.email ?? null },
    project: inv.project,
    subtotal: numOr0(inv.subtotal),
    total,
    amountPaid: numOr0(inv.amountPaid),
    hasPdf: Boolean(inv.pdfPath),
    sentAt: inv.sentAt,
    voidedAt: inv.voidedAt,
    createdBy: inv.creator?.fullName ?? null,
    items: inv.items.map((i) => ({ id: i.id, description: i.description, quantity: numOr0(i.quantity), unitPrice: numOr0(i.unitPrice), amount: numOr0(i.amount) })),
    requests: inv.paymentRequests.map((r) => ({
      id: r.id,
      label: r.label,
      amount: numOr0(r.amount),
      dueDate: isoDate(r.dueDate),
      status: r.status,
      url: r.xenditUrl,
      expiresAt: r.xenditExpiresAt,
      paidAt: r.paidAt,
    })),
    deliveries: inv.deliveries.map((d) => ({ id: d.id, to: d.toEmails, cc: d.ccEmails, sentAt: d.sentAt, sentBy: d.sender?.fullName ?? null, status: d.status, error: d.error })),
    payments: inv.payments.map((p) => ({
      id: p.id,
      externalId: p.externalId,
      amount: numOr0(p.amount),
      currency: p.currency,
      paidAt: p.paidAt,
      channel: p.channel,
      fee: num(p.feeAmount),
      net: num(p.netAmount),
      settlementIdr: num(p.settlementAmountIdr),
      fxRate: num(p.fxRateToIdr),
      needsReview: p.needsReview,
    })),
    viewer: {
      canEdit: editable && inv.status === "draft",
      canSend: editable && inv.status !== "void",
      canVoid: editable && inv.status !== "void" && inv.status !== "draft",
      canDelete: editable && inv.status === "draft",
      canRegenerate: editable && inv.status !== "void" && inv.status !== "draft",
    },
    today: todayIn(user.timezone),
  };
}

export type InvoiceDetail = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;

/** Everything the PDF template needs (system read — the caller checked access). */
export async function getInvoiceDocument(id: string) {
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: {
      client: { select: { contacts: { where: { isPrimary: true }, select: { name: true } } } },
      project: { select: { code: true, name: true } },
      items: { orderBy: { position: "asc" } },
      paymentRequests: { orderBy: { position: "asc" } },
    },
  });
  if (!inv) return null;
  const settings = await prisma.appSetting.findMany({ where: { key: { in: ["studio_profile"] } } });
  const studio = (settings.find((s) => s.key === "studio_profile")?.value ?? {}) as { name?: string; address?: string; email?: string; website?: string };
  return {
    number: inv.number,
    status: inv.status,
    currency: inv.currency,
    issueDate: isoDate(inv.issueDate),
    notes: inv.notes,
    billTo: { name: inv.billToName, contactName: inv.client.contacts[0]?.name ?? null, address: inv.billToAddress, email: inv.billToEmail },
    project: inv.project,
    items: inv.items.map((i) => ({ description: i.description, quantity: numOr0(i.quantity), unitPrice: numOr0(i.unitPrice), amount: numOr0(i.amount) })),
    total: numOr0(inv.total),
    amountPaid: numOr0(inv.amountPaid),
    requests: inv.paymentRequests.map((r) => ({ label: r.label, amount: numOr0(r.amount), dueDate: isoDate(r.dueDate), status: r.status, url: r.xenditUrl })),
    studio: { name: studio.name || "Odama Studio", address: studio.address ?? "", email: studio.email ?? "", website: studio.website ?? "" },
  };
}

export type InvoiceDocumentData = NonNullable<Awaited<ReturnType<typeof getInvoiceDocument>>>;
