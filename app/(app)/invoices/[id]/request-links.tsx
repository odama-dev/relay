"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { InvoiceDetail } from "@/lib/invoices/queries";
import { formatDate } from "@/lib/format";
import { regeneratePaymentLink } from "../actions";
import { StatusBadge } from "@/components/status-badge";
import { MoneyText } from "@/components/money-text";
import { Button } from "@/components/ui/button";
import { icons } from "@/components/icon";

/** Payment requests with their Xendit links (M5.4); expired links can be renewed. */
export function RequestLinks({
  invoiceId,
  currency,
  requests,
  canRegenerate,
  status,
}: {
  invoiceId: string;
  currency: string;
  requests: InvoiceDetail["requests"];
  canRegenerate: boolean;
  status: string;
}) {
  const router = useRouter();
  return (
    <ul className="flex flex-col gap-2 text-body">
      {requests.map((r) => {
        const expired = r.status === "expired" || (r.status === "pending" && r.expiresAt && new Date(r.expiresAt) < new Date());
        return (
          <li key={r.id} className="bg-surface-3 shadow-surface-2 flex flex-col gap-1 rounded-lg px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{r.label}</span>
              <MoneyText value={r.amount} currency={currency} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-caption">
                Due {formatDate(r.dueDate)}
                {r.paidAt && ` · paid ${formatDate(r.paidAt)}`}
              </span>
              <StatusBadge value={expired ? "expired" : r.status} />
            </div>
            {status !== "draft" && r.status !== "paid" && r.status !== "void" && (
              <div className="flex items-center gap-1">
                {r.url && !expired && (
                  <Button
                    variant="ghost"
                    size="compact"
                    onClick={() => {
                      void navigator.clipboard.writeText(r.url!);
                      toast.success("Payment link copied");
                    }}
                   leadingIcon={icons.copy}>
                    Copy link
                  </Button>
                )}
                {canRegenerate && (expired || !r.url) && (
                  <Button
                    variant="ghost"
                    size="compact"
                    onClick={async () => {
                      const res = await regeneratePaymentLink(invoiceId, r.id);
                      if (!res.ok) return void toast.error(res.error);
                      toast.success("New payment link created");
                      router.refresh();
                    }}
                   leadingIcon={icons.refresh}>
                    New link
                  </Button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
