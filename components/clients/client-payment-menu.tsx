"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CLIENT_PAYMENT_LABELS, type ClientPaymentState } from "@/lib/dashboard/pure";
import { CLIENT_PAYMENT_STATUSES } from "@/lib/validation";
import { DropdownContent, DropdownMenu, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { StatusBadge } from "@/components/status-badge";
import { icons } from "@/components/icon";
import { setClientPaymentStatus } from "@/app/(app)/clients/actions";

/**
 * A client's payment status badge. It follows the client's open payment
 * requests on its own; PM, Sales and C-Level can click it to set a status by
 * hand (marked "manual") or go back to automatic.
 */
export function ClientPaymentMenu({
  id,
  status,
  auto,
  manual,
  canEdit,
}: {
  id: string;
  status: ClientPaymentState;
  /** The status from the payment requests, named on the "Automatic" choice. */
  auto: ClientPaymentState;
  manual: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const label = CLIENT_PAYMENT_LABELS[status];
  const badge = <StatusBadge value={status} label={`${label}${manual ? " · manual" : ""}`} />;
  if (!canEdit) return badge;

  const choose = async (next: (typeof CLIENT_PAYMENT_STATUSES)[number] | null) => {
    setBusy(true);
    const res = await setClientPaymentStatus(id, next);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(next ? `Payment set to ${CLIENT_PAYMENT_LABELS[next]}` : "Payment follows invoices again");
    router.refresh();
  };

  // Menu clicks bubble through the portal to a clickable table row; stop them here.
  return (
    <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownTrigger
          render={
            <button
              type="button"
              disabled={busy}
              aria-label={`Payment: ${label}. Change status`}
              className="cursor-pointer rounded-full outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)] disabled:opacity-60"
            >
              {badge}
            </button>
          }
        />
        <DropdownContent align="start" className="w-56">
          {CLIENT_PAYMENT_STATUSES.map((s, i) => (
            <MenuItem
              key={s}
              index={i}
              label={CLIENT_PAYMENT_LABELS[s]}
              icon={manual && s === status ? icons.check : undefined}
              onSelect={() => void choose(s)}
            />
          ))}
          <DropdownSeparator />
          <MenuItem
            index={CLIENT_PAYMENT_STATUSES.length}
            label={`Automatic (${CLIENT_PAYMENT_LABELS[auto]})`}
            icon={manual ? icons.refresh : icons.check}
            onSelect={() => manual && void choose(null)}
          />
        </DropdownContent>
      </DropdownMenu>
    </span>
  );
}
