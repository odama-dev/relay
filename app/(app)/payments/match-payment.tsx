"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { matchPaymentToRequest } from "../invoices/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SelectField } from "@/components/select-field";

/** M5.7 — Finance links an unmatched payment to an open payment request. */
export function MatchPaymentButton({ paymentId, options }: { paymentId: string; options: { id: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button size="sm" variant="tertiary" onClick={() => setOpen(true)}>
        Match
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Match payment</DialogTitle>
            <DialogDescription>The request becomes paid and the invoice status updates. Your name is recorded on the match.</DialogDescription>
          </DialogHeader>
          <SelectField aria-label="Payment request" value={requestId} onChange={setRequestId} placeholder="Choose a payment request" options={options.map((o) => ({ value: o.id, label: o.label }))} />
          <DialogFooter>
            <Button variant="tertiary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!requestId || busy}
              onClick={async () => {
                setBusy(true);
                const res = await matchPaymentToRequest(paymentId, requestId);
                setBusy(false);
                if (!res.ok) return void toast.error(res.error);
                toast.success("Payment matched");
                setOpen(false);
                router.refresh();
              }}
            >
              {busy ? "Matching…" : "Match payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
