import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { getInvoice, getInvoiceDocument } from "@/lib/invoices/queries";
import { getSettings } from "@/lib/settings";
import { INVOICE_STATUS_LABELS } from "@/lib/invoices/pure";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { MoneyText } from "@/components/money-text";
import { InvoiceDocument } from "@/components/invoice/invoice-document";
import { InvoiceActions } from "./invoice-actions";
import { RequestLinks } from "./request-links";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess(perms.viewInvoices);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const inv = await getInvoice(user, id);
  if (!inv) notFound();
  const [doc, settings] = await Promise.all([getInvoiceDocument(id), getSettings()]);
  const outstanding = inv.status === "void" ? 0 : Math.max(0, inv.total - inv.amountPaid);
  const defaultTo = [...new Set([inv.client.billingEmail, inv.client.primaryEmail].filter((e): e is string => Boolean(e)))];

  return (
    <div className="flex flex-col">
      <PageHeader
        title={inv.number ?? "Draft invoice"}
        eyebrow={
          <span className="text-muted-foreground flex items-center gap-1.5 text-caption">
            <Link href="/invoices" className="hover:text-foreground">Invoices</Link>
            <span>/</span>
            <Link href={`/projects/${inv.project.id}?tab=invoices`} className="hover:text-foreground">{inv.project.code}</Link>
          </span>
        }
        meta={
          <div className="flex flex-wrap items-center gap-3 text-body">
            <StatusBadge value={inv.status} label={INVOICE_STATUS_LABELS[inv.status]} />
            <span className="text-muted-foreground">
              {inv.billTo.name} · issued {formatDate(inv.issueDate)}
              {inv.sentAt && ` · sent ${formatDateTime(inv.sentAt, user.timezone)}`}
            </span>
          </div>
        }
        actions={
          <InvoiceActions
            invoice={{ id: inv.id, number: inv.number, status: inv.status, viewer: inv.viewer, projectId: inv.project.id }}
            send={{
              defaultTo,
              // {number} is filled in when the invoice is issued on first send.
              subject: `Invoice ${inv.number ?? "{number}"} from ${settings.studio_profile.name}`,
              message: `Hi ${inv.billTo.name},\n\nPlease find attached our invoice for ${inv.project.name}. You can pay each installment online with the links below.\n\nThank you!`,
              sender: `${settings.invoice_sender_name} <${settings.invoice_sender_email}>`,
              requests: inv.requests.filter((r) => r.status !== "paid" && r.status !== "void").map((r) => ({ label: r.label, amount: formatMoney(r.amount, inv.currency), due: formatDate(r.dueDate) })),
              resend: inv.status !== "draft",
            }}
          />
        }
      />

      <div className="grid gap-8 xl:grid-cols-[1fr_360px]">
        <div className="overflow-x-auto">
          <div className="mx-auto w-fit">
            {doc && <InvoiceDocument invoice={doc} />}
          </div>
        </div>

        <aside className="flex flex-col gap-6">
          <dl className="bg-surface-3 shadow-surface-2 grid grid-cols-2 gap-3 rounded-xl p-4 text-body">
            <div>
              <dt className="text-muted-foreground text-caption">Total</dt>
              <dd><MoneyText value={inv.total} currency={inv.currency} className="text-subtitle font-medium" /></dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-caption">Outstanding</dt>
              <dd><MoneyText value={outstanding} currency={inv.currency} className="text-subtitle font-medium" /></dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-caption">Paid</dt>
              <dd><MoneyText value={inv.amountPaid} currency={inv.currency} /></dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-caption">Created by</dt>
              <dd>{inv.createdBy ?? "—"}</dd>
            </div>
          </dl>

          <section className="flex flex-col gap-2">
            <h3 className="text-body font-medium">Payment requests</h3>
            <RequestLinks invoiceId={inv.id} currency={inv.currency} requests={inv.requests} canRegenerate={inv.viewer.canRegenerate} status={inv.status} />
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-body font-medium">Payments</h3>
            {inv.payments.length === 0 ? (
              <p className="text-muted-foreground text-body">No payments yet. They&apos;re recorded automatically from Xendit.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-body">
                {inv.payments.map((p) => (
                  <li key={p.id} className="bg-surface-3 shadow-surface-2 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <MoneyText value={p.amount} currency={p.currency} className="font-medium" />
                      <span className="text-muted-foreground text-caption">{formatDateTime(p.paidAt, user.timezone)}</span>
                    </div>
                    <p className="text-muted-foreground text-caption">
                      {p.channel ?? "Xendit"} · {p.externalId}
                      {p.settlementIdr !== null && p.currency !== "IDR" && ` · received ${formatMoney(p.settlementIdr, "IDR")} @ ${p.fxRate}`}
                      {p.fee !== null && ` · fee ${formatMoney(p.fee, p.currency)}`}
                    </p>
                    {p.needsReview && <p className="text-warning mt-1 text-caption">Amount differs from the request — Finance should review.</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-body font-medium">Sent to client</h3>
            {inv.deliveries.length === 0 ? (
              <p className="text-muted-foreground text-body">Not sent yet.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-body">
                {inv.deliveries.map((d) => (
                  <li key={d.id} className="flex flex-col">
                    <span className="flex items-center gap-2">
                      <StatusBadge value={d.status === "sent" ? "paid" : "overdue"} label={d.status === "sent" ? "Sent" : "Failed"} />
                      <span className="text-muted-foreground text-caption">{formatDateTime(d.sentAt, user.timezone)}{d.sentBy ? ` · ${d.sentBy}` : ""}</span>
                    </span>
                    <span className="text-muted-foreground mt-0.5 truncate text-caption">
                      To {d.to.join(", ")}
                      {d.cc.length ? ` · CC ${d.cc.join(", ")}` : ""}
                    </span>
                    {d.error && <span className="text-destructive text-caption">{d.error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
