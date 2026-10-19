import { requireAccess, asUser } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { numOr0, num } from "@/lib/money";
import { formatDate, formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { EntityTabs } from "@/components/entity-tabs";
import { PaymentsTable, type PaymentRow } from "./payments-table";

export const metadata = { title: "Payments" };

/** Every Xendit payment (Finance, Sales, C-Level) and the unmatched queue (M5.7). */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireAccess(perms.viewPayments);
  const { tab } = await searchParams;
  const [payments, openRequests] = await asUser(user, (tx) =>
    Promise.all([
      tx.payment.findMany({
        orderBy: { paidAt: "desc" },
        take: 300,
        include: {
          invoice: { select: { id: true, number: true, billToName: true, project: { select: { code: true } } } },
          paymentRequest: { select: { label: true } },
          matcher: { select: { fullName: true } },
        },
      }),
      perms.matchPayments(user)
        ? tx.invoicePaymentRequest.findMany({
            where: { status: { in: ["pending", "expired"] }, invoice: { status: { notIn: ["draft", "void"] } } },
            include: { invoice: { select: { number: true, billToName: true, currency: true } } },
            orderBy: { dueDate: "asc" },
          })
        : Promise.resolve([]),
    ]),
  );
  const unmatched = payments.filter((p) => !p.invoiceId);
  const review = payments.filter((p) => p.needsReview);
  const options = openRequests.map((r) => ({
    id: r.id,
    label: `${r.invoice.number ?? "Draft"} · ${r.label} · ${formatMoney(numOr0(r.amount), r.invoice.currency)} · ${r.invoice.billToName}`,
  }));

  const toRow = (p: (typeof payments)[number]): PaymentRow => ({
    id: p.id,
    amount: numOr0(p.amount),
    currency: p.currency,
    paidAt: p.paidAt.toISOString(),
    invoice: p.invoice ? { id: p.invoice.id, number: p.invoice.number, billToName: p.invoice.billToName } : null,
    request: p.paymentRequest?.label ?? null,
    externalRef: (p.raw as { external_id?: string })?.external_id ?? p.externalId,
    channel: p.channel ?? "Xendit",
    settledIdr: p.currency !== "IDR" ? num(p.settlementAmountIdr) : null,
    matchedBy: p.matcher?.fullName ?? null,
    needsReview: p.needsReview,
  });
  const list = (rows: typeof payments, showMatch: boolean) => (
    <PaymentsTable
      rows={rows.map(toRow)}
      timezone={user.timezone}
      matchOptions={showMatch && perms.matchPayments(user) ? options : undefined}
      emptyTitle={showMatch ? "Nothing to match" : "No payments yet"}
      emptyDescription={showMatch ? "Every Xendit payment is matched to an invoice." : "Payments are recorded automatically from Xendit."}
    />
  );

  return (
    <div className="flex flex-col">
      <PageHeader title="Payments" compact />
      <EntityTabs
        variant="toolbar"
        initial={tab ?? (unmatched.length ? "unmatched" : "all")}
        items={[
          { value: "unmatched", label: "Unmatched", count: unmatched.length, content: list(unmatched, true) },
          { value: "review", label: "Needs review", count: review.length || undefined, content: list(review, false) },
          { value: "all", label: "All payments", count: payments.length, content: list(payments, false) },
        ]}
      />
      <p className="text-muted-foreground mt-4 text-caption">
        Recorded automatically from Xendit webhooks — there&apos;s no manual entry in Phase 1. Showing the latest 300. Due dates use{" "}
        {formatDate(new Date())} as today.
      </p>
    </div>
  );
}
