import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { numOr0 } from "@/lib/money";
import { formatMoney } from "@/lib/format";
import { xenditConfigured } from "@/lib/env";
import { SimulatePay } from "./simulate-pay";

export const dynamic = "force-dynamic";

/**
 * Local stand-in for a Xendit checkout page — only when Xendit isn't
 * configured and not in production. Posts a fake, correctly signed webhook.
 */
export default async function DevPayPage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === "production" || xenditConfigured) notFound();
  const { id } = await params;
  const r = await prisma.invoicePaymentRequest.findUnique({ where: { id }, include: { invoice: true } }).catch(() => null);
  if (!r) notFound();
  return (
    <div className="grid min-h-dvh place-items-center bg-white px-4 text-zinc-900">
      <div className="w-full max-w-sm rounded-xl border p-6">
        <p className="text-caption tracking-wide text-zinc-500 uppercase">Xendit test checkout (local)</p>
        <h1 className="mt-2 text-title font-medium">{r.invoice.number} · {r.label}</h1>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(numOr0(r.amount), r.invoice.currency)}</p>
        <p className="mt-1 text-body text-zinc-500">Status: {r.status}</p>
        <SimulatePay requestId={r.id} amount={numOr0(r.amount)} currency={r.invoice.currency} xenditId={r.xenditInvoiceId ?? `dev_${r.id}`} />
      </div>
    </div>
  );
}
