"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { InvoiceDetail } from "@/lib/invoices/queries";
import { PLATFORM_LABELS } from "@/lib/invoices/pure";
import { currencyDecimals, formatDate } from "@/lib/format";
import { PAYMENT_PLATFORMS } from "@/lib/validation";
import { ProofDecisionDialog } from "@/components/invoice/proof-decision-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { DatePicker } from "@/components/date-picker";
import { AmountInput } from "@/components/amount-input";
import { StatusBadge } from "@/components/status-badge";
import { MoneyText } from "@/components/money-text";
import { Icon, icons } from "@/components/icon";

const PROOF_ACCEPT = "application/pdf,image/png,image/jpeg,image/gif,image/webp";
const STATUS_LABEL = { submitted: "Waiting for Finance", verified: "Verified", rejected: "Rejected" } as const;
const STATUS_TONE = { submitted: "payment_submitted", verified: "paid", rejected: "overdue" } as const;

type Platform = (typeof PAYMENT_PLATFORMS)[number];

/**
 * Phase 2 · M9 — proofs of payments made outside Xendit. Sales uploads one
 * (the invoice becomes Payment submitted); Finance verifies it (Paid /
 * Partially paid) or rejects it with a note (back to Sent).
 */
export function PaymentProofs({ invoice, today }: { invoice: InvoiceDetail; today: string }) {
  const [adding, setAdding] = useState(false);
  const [deciding, setDeciding] = useState<{ id: string; verify: boolean } | null>(null);
  const { proofs, viewer } = invoice;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-body font-medium">Payment proofs</h3>
        {viewer.canSubmitProof && (
          <Button variant="ghost" size="sm" leadingIcon={icons.upload} onClick={() => setAdding(true)}>
            Upload proof
          </Button>
        )}
      </div>
      {proofs.length === 0 ? (
        <p className="text-muted-foreground text-body">
          {invoice.platform === "xendit" ? "Paid through Xendit links. Upload a proof only for a payment made another way." : "No proofs yet. Sales uploads one when the client pays."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2 text-body">
          {proofs.map((p) => (
            <li key={p.id} className="bg-surface-3 shadow-surface-2 flex flex-col gap-1 rounded-lg px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <MoneyText value={p.amount} currency={p.currency} className="font-medium" />
                <StatusBadge value={STATUS_TONE[p.status]} label={STATUS_LABEL[p.status]} />
              </div>
              <p className="text-muted-foreground text-caption">
                {PLATFORM_LABELS[p.platform]} · paid {formatDate(p.paidOn)}
                {p.request && ` · ${p.request}`}
                {p.fxRate !== null && p.currency !== "IDR" && ` · @ ${p.fxRate}`}
                {p.submittedBy && ` · by ${p.submittedBy}`}
              </p>
              {p.note && <p className="text-caption">{p.note}</p>}
              {p.hasFile && (
                <a href={`/api/files/payment-proofs/${p.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-caption underline underline-offset-2">
                  <Icon name="file" size={14} className="text-muted-foreground" />
                  {p.fileName ?? "Proof"}
                </a>
              )}
              {p.status === "rejected" && p.reviewNote && (
                <p className="text-destructive text-caption">
                  {p.reviewedBy ? `${p.reviewedBy}: ` : ""}
                  {p.reviewNote}
                </p>
              )}
              {p.status === "submitted" && viewer.canVerifyProof && p.submittedById !== viewer.userId && (
                <div className="mt-1 flex gap-2">
                  <Button size="sm" onClick={() => setDeciding({ id: p.id, verify: true })}>
                    Verify
                  </Button>
                  <Button size="sm" variant="tertiary" onClick={() => setDeciding({ id: p.id, verify: false })}>
                    Reject
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && <ProofDialog invoice={invoice} today={today} onClose={() => setAdding(false)} />}
      {deciding && (
        <ProofDecisionDialog
          proof={proofs.find((p) => p.id === deciding.id)!}
          verify={deciding.verify}
          onClose={() => setDeciding(null)}
        />
      )}
    </section>
  );
}

function ProofDialog({ invoice, today, onClose }: { invoice: InvoiceDetail; today: string; onClose: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const open = invoice.requests.filter((r) => r.status !== "paid" && r.status !== "void");
  const [requestId, setRequestId] = useState(open[0]?.id ?? "");
  const [amount, setAmount] = useState<number | null>(open[0]?.amount ?? null);
  const [paidOn, setPaidOn] = useState(today);
  const [platform, setPlatform] = useState<Platform>(invoice.platform === "xendit" ? "bank_transfer" : invoice.platform);
  const [rate, setRate] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const foreign = invoice.currency !== "IDR";

  const submit = async () => {
    if (!file) return setError("Attach the proof of payment.");
    if (!amount) return setError("Enter the amount paid.");
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set("file", file);
    body.set("data", JSON.stringify({ paymentRequestId: requestId, amount, paidOn, platform, note, fxRateToIdr: foreign ? rate : null }));
    const res = await fetch(`/api/invoices/${invoice.id}/proofs`, { method: "POST", body });
    setBusy(false);
    if (!res.ok) return setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "The proof couldn't be uploaded.");
    toast.success("Proof sent to Finance");
    onClose();
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload payment proof</DialogTitle>
          <DialogDescription>The invoice shows Payment submitted until Finance checks it against the account.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {open.length > 0 && (
            <FormField label="For" htmlFor="pp-request">
              <SelectField
                id="pp-request"
                value={requestId}
                onChange={(v) => {
                  setRequestId(v);
                  const r = open.find((x) => x.id === v);
                  if (r) setAmount(r.amount);
                }}
                noneLabel="The invoice as a whole"
                options={open.map((r) => ({ value: r.id, label: r.label }))}
              />
            </FormField>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Amount paid" htmlFor="pp-amount" required>
              <AmountInput id="pp-amount" value={amount} onChange={setAmount} decimals={currencyDecimals(invoice.currency)} prefix={invoice.currency} />
            </FormField>
            <FormField label="Paid on" htmlFor="pp-date" required>
              <DatePicker id="pp-date" value={paidOn} onChange={setPaidOn} className="w-full" />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Paid via" htmlFor="pp-platform" required>
              <SelectField id="pp-platform" value={platform} onChange={(v) => setPlatform(v as Platform)} options={PAYMENT_PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))} />
            </FormField>
            {foreign && (
              <FormField label={`Rate, IDR per ${invoice.currency}`} htmlFor="pp-rate" hint="On the day it was paid. Finance confirms it.">
                <AmountInput id="pp-rate" value={rate} onChange={setRate} decimals={4} />
              </FormField>
            )}
          </div>
          <FormField label="Proof" htmlFor="pp-file" required hint="Transfer receipt or statement — PDF or image, up to 10 MB.">
            <input ref={fileRef} id="pp-file" type="file" accept={PROOF_ACCEPT} className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <div className="flex min-h-9 items-center gap-2 text-body">
              {file ? (
                <>
                  <Icon name="file" size={14} className="text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="compact"
                    onClick={() => {
                      setFile(null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                  >
                    Remove
                  </Button>
                </>
              ) : (
                <Button type="button" variant="tertiary" size="sm" onClick={() => fileRef.current?.click()} leadingIcon={icons.upload}>
                  Attach proof
                </Button>
              )}
            </div>
          </FormField>
          <FormField label="Note" htmlFor="pp-note">
            <Textarea id="pp-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — e.g. the sender's account name" />
          </FormField>
          {error && <p role="alert" className="text-destructive text-body">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Uploading…" : "Send to Finance"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
