"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import type { InvoiceStatus } from "@prisma/client";
import { deleteInvoice, sendInvoiceToClient, voidInvoice } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/form-field";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RowActions } from "@/components/row-actions";
import { PillButton } from "@/components/pill-button";
import { Icon, icons } from "@/components/icon";

type Viewer = { canEdit: boolean; canSend: boolean; canVoid: boolean; canDelete: boolean; canRegenerate: boolean };

const splitEmails = (s: string) => s.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);

export function InvoiceActions({
  invoice,
  send,
}: {
  invoice: { id: string; number: string | null; status: InvoiceStatus; viewer: Viewer; projectId: string };
  send: { defaultTo: string[]; subject: string; message: string; sender: string; requests: { label: string; amount: string; due: string }[]; resend: boolean };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // `?send=1` (dashboard → Send) opens the send dialog straight away.
  const [sending, setSending] = useState(() => searchParams.get("send") === "1" && invoice.viewer.canSend);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("send")) return;
    url.searchParams.delete("send");
    window.history.replaceState(window.history.state, "", url);
  }, []);
  const [confirm, setConfirm] = useState<"void" | "delete" | null>(null);

  return (
    <>
      <Button variant="ghost" size="sm" asChild leadingIcon={icons.pdf}>
        <a href={`/api/invoices/${invoice.id}/pdf?download=1`}>PDF
        </a>
      </Button>
      {invoice.viewer.canEdit && (
        <Button variant="tertiary" size="sm" onClick={() => router.push(`/invoices/${invoice.id}/edit`)} leadingIcon={icons.edit}>
          Edit
        </Button>
      )}
      {invoice.viewer.canSend && (
        <PillButton icon="send" onClick={() => setSending(true)}>
          {send.resend ? "Send again" : "Send to client"}
        </PillButton>
      )}
      <RowActions
        label="Invoice actions"
        variant="tertiary"
        actions={[
          { label: "Void invoice", icon: "archive", destructive: true, hidden: !invoice.viewer.canVoid, onSelect: () => setConfirm("void") },
          { label: "Delete draft", icon: "delete", destructive: true, hidden: !invoice.viewer.canDelete || Boolean(invoice.number), onSelect: () => setConfirm("delete") },
          { label: "Void draft", icon: "archive", destructive: true, hidden: !invoice.viewer.canDelete || !invoice.number, onSelect: () => setConfirm("void") },
        ]}
      />
      {sending && <SendDialog invoiceId={invoice.id} send={send} onClose={() => setSending(false)} onSent={() => router.refresh()} />}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "void" ? `Void ${invoice.number ?? "this invoice"}?` : "Delete this draft?"}
        description={
          confirm === "void"
            ? "Unpaid payment links are cancelled and the number is never reused. To bill again, create a new invoice."
            : "The draft is removed for good."
        }
        confirmLabel={confirm === "void" ? "Void invoice" : "Delete draft"}
        cancelLabel="Keep it"
        destructive
        onConfirm={async () => {
          const res = confirm === "void" ? await voidInvoice(invoice.id) : await deleteInvoice(invoice.id);
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          toast.success(confirm === "void" ? "Invoice voided" : "Draft deleted");
          if (confirm === "delete") router.push(`/projects/${invoice.projectId}?tab=invoices`);
          else router.refresh();
        }}
      />
    </>
  );
}

/**
 * M5.5 — recipients (billing email + primary contact by default), optional CC,
 * and a preview of what goes out: subject, message, the PDF and the links.
 */
function SendDialog({
  invoiceId,
  send,
  onClose,
  onSent,
}: {
  invoiceId: string;
  send: { defaultTo: string[]; subject: string; message: string; sender: string; requests: { label: string; amount: string; due: string }[]; resend: boolean };
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState(send.defaultTo.join(", "));
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(send.subject);
  const [message, setMessage] = useState(send.message);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="lg" className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{send.resend ? "Send invoice again" : "Send to client"}</DialogTitle>
          <DialogDescription>
            From {send.sender}.{" "}
            {send.resend ? "The client gets the same invoice and links." : "The first send issues the invoice number, creates the Xendit payment links and marks the invoice Sent."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField label="To" htmlFor="sd-to" required hint="Separate addresses with commas.">
            <Input id="sd-to" value={to} onChange={(e) => setTo(e.target.value)} />
          </FormField>
          <FormField label="CC" htmlFor="sd-cc">
            <Input id="sd-cc" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Optional" />
          </FormField>
          <FormField label="Subject" htmlFor="sd-subject" required>
            <Input id="sd-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </FormField>
          <FormField label="Message" htmlFor="sd-message">
            <Textarea id="sd-message" rows={6} value={message} onChange={(e) => setMessage(e.target.value)} />
          </FormField>
          <div className="bg-surface-3 shadow-surface-2 rounded-xl p-3 text-body">
            <p className="text-muted-foreground mb-2 text-caption">The email also lists</p>
            <ul className="flex flex-col gap-1">
              {send.requests.map((r) => (
                <li key={r.label} className="flex justify-between gap-3">
                  <span>{r.label} · due {r.due}</span>
                  <span className="tabular">{r.amount} · Pay online link</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 flex items-center gap-1.5">
              <Icon name="file" size={14} className="text-muted-foreground" />
              <a href={`/api/invoices/${invoiceId}/pdf`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                Invoice PDF
              </a>{" "}
              <span className="text-muted-foreground">attached</span>
            </p>
          </div>
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
              const res = await sendInvoiceToClient(invoiceId, { to: splitEmails(to), cc: splitEmails(cc), subject, message });
              setBusy(false);
              if (!res.ok) return setError(res.error);
              toast.success(`Invoice ${res.data.number} sent`);
              onSent();
              onClose();
            }}
          >
            {busy ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
