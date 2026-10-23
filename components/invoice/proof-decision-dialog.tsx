"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { decidePaymentProof } from "@/app/(app)/invoices/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/form-field";
import { AmountInput } from "@/components/amount-input";
import { MoneyText } from "@/components/money-text";

/**
 * Phase 2 · M9 — Finance verifies a payment proof (recorded as a payment,
 * counts as revenue) or rejects it with a note. Invoice page and the
 * Payments verification queue.
 */
export function ProofDecisionDialog({
  proof,
  verify,
  onClose,
}: {
  proof: { id: string; amount: number; currency: string; fxRate: number | null };
  verify: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [rate, setRate] = useState<number | null>(proof.fxRate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const foreign = proof.currency !== "IDR";

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{verify ? "Verify payment" : "Reject proof"}</DialogTitle>
          <DialogDescription>
            {verify
              ? "Confirm the money is in the account. It's recorded as a payment and counts as revenue."
              : "The invoice goes back to Sent and Sales sees your note."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <p className="text-body">
            <MoneyText value={proof.amount} currency={proof.currency} className="font-medium" />
          </p>
          {verify && foreign && (
            <FormField label={`Rate, IDR per ${proof.currency}`} htmlFor="dp-rate" hint="Leave empty to use the reference rate of the payment day.">
              <AmountInput id="dp-rate" value={rate} onChange={setRate} decimals={4} />
            </FormField>
          )}
          <FormField label="Note" htmlFor="dp-note" required={!verify}>
            <Textarea id="dp-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={verify ? "Optional" : "e.g. Not in the account yet"} />
          </FormField>
          {error && <p role="alert" className="text-destructive text-body">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const res = await decidePaymentProof(proof.id, { verify, note, fxRateToIdr: verify && foreign ? rate : null });
              setBusy(false);
              if (!res.ok) return setError(res.error);
              toast.success(verify ? "Payment verified" : "Proof rejected");
              onClose();
              router.refresh();
            }}
          >
            {busy ? "Saving…" : verify ? "Verify" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
