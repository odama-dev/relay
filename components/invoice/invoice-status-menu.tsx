"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { InvoiceStatus } from "@prisma/client";
import { INVOICE_STATUS_LABELS } from "@/lib/invoices/pure";
import { MANUAL_INVOICE_STATUSES } from "@/lib/validation";
import { DropdownContent, DropdownMenu, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { StatusBadge } from "@/components/status-badge";
import { icons } from "@/components/icon";
import { setInvoiceStatus } from "@/app/(app)/invoices/actions";

/**
 * The invoice status badge. It follows payments and due dates on its own;
 * Sales and Finance can click it to set a status by hand (marked "manual")
 * or go back to automatic. Drafts and void invoices aren't changed here.
 */
export function InvoiceStatusMenu({ id, status, manual, canEdit }: { id: string; status: InvoiceStatus; manual: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const badge = <StatusBadge value={status} label={`${INVOICE_STATUS_LABELS[status]}${manual ? " · manual" : ""}`} />;
  if (!canEdit || status === "draft" || status === "void") return badge;

  const choose = async (next: InvoiceStatus | null) => {
    setBusy(true);
    const res = await setInvoiceStatus(id, next);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(next ? `Status set to ${INVOICE_STATUS_LABELS[next]}` : "Status follows payments again");
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
              aria-label={`Status: ${INVOICE_STATUS_LABELS[status]}. Change status`}
              className="cursor-pointer rounded-full outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)] disabled:opacity-60"
            >
              {badge}
            </button>
          }
        />
        <DropdownContent align="start" className="w-52">
          {MANUAL_INVOICE_STATUSES.map((s, i) => (
            <MenuItem
              key={s}
              index={i}
              label={INVOICE_STATUS_LABELS[s]}
              icon={manual && s === status ? icons.check : undefined}
              onSelect={() => void choose(s)}
            />
          ))}
          <DropdownSeparator />
          <MenuItem
            index={MANUAL_INVOICE_STATUSES.length}
            label="Automatic (from payments)"
            icon={manual ? icons.refresh : icons.check}
            onSelect={() => manual && void choose(null)}
          />
        </DropdownContent>
      </DropdownMenu>
    </span>
  );
}
