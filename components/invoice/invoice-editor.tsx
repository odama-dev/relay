"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { currencyDecimals, formatMoney } from "@/lib/format";
import { INVOICE_KIND_LABELS, invoiceTotal, itemAmount, PLATFORM_LABELS, requestsMatchTotal, splitByPercent, fromMinor, toMinor } from "@/lib/invoices/pure";
import { CURRENCIES, INVOICE_KINDS, PAYMENT_PLATFORMS } from "@/lib/validation";
import { createInvoice, updateInvoice } from "@/app/(app)/invoices/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormSection } from "@/components/form-field";
import { DatePicker } from "@/components/date-picker";
import { SelectField } from "@/components/select-field";
import { AmountInput } from "@/components/amount-input";
import { Icon, icons } from "@/components/icon";
import { cn } from "@/lib/utils";

export type EditorItem = { description: string; quantity: number | null; unitPrice: number | null };
export type EditorRequest = { label: string; amount: number | null; percent: number | null; dueDate: string };
type Kind = (typeof INVOICE_KINDS)[number];
type Platform = (typeof PAYMENT_PLATFORMS)[number];
type Currency = (typeof CURRENCIES)[number];

/**
 * M5.1 — items (description, quantity, unit price → amount) and payment
 * requests entered as a percentage or an amount, which must add up to the
 * total. Bill-to and currency start from the project's client and can be
 * changed; the PDF keeps the studio's invoice design. Used for new drafts
 * and for editing a draft.
 */
export function InvoiceEditor({
  projectId,
  invoiceId,
  initial,
}: {
  projectId: string;
  /** Present when editing a draft. */
  invoiceId?: string;
  initial: {
    issueDate: string;
    currency: Currency;
    billTo: { name: string; address: string; email: string };
    notes: string;
    kind: Kind | null;
    platform: Platform;
    items: EditorItem[];
    requests: EditorRequest[];
  };
}) {
  const router = useRouter();
  const [issueDate, setIssueDate] = useState(initial.issueDate);
  const [currency, setCurrency] = useState<Currency>(initial.currency);
  const [billTo, setBillTo] = useState(initial.billTo);
  const [kind, setKind] = useState<Kind | null>(initial.kind);
  const [platform, setPlatform] = useState<Platform>(initial.platform);
  const [notes, setNotes] = useState(initial.notes);
  const [items, setItems] = useState<EditorItem[]>(initial.items);
  const [requests, setRequests] = useState<EditorRequest[]>(initial.requests);
  const [byPercent, setByPercent] = useState(initial.requests.every((r) => r.percent !== null));
  const [busy, setBusy] = useState(false);
  const decimals = currencyDecimals(currency);
  const money = (v: number) => formatMoney(v, currency);

  const validItems = items.filter((i) => i.description.trim() && (i.quantity ?? 0) > 0 && i.unitPrice !== null);
  const total = invoiceTotal(validItems.map((i) => ({ quantity: i.quantity!, unitPrice: i.unitPrice! })), currency);
  const amounts = byPercent
    ? splitByPercent(total, requests.map((r) => r.percent ?? 0), currency)
    : requests.map((r) => r.amount ?? 0);
  const allocated = fromMinor(amounts.reduce((s, a) => s + toMinor(a, currency), 0), currency);
  const balanced = total > 0 && requestsMatchTotal(total, amounts, currency);
  const percentSum = requests.reduce((s, r) => s + (r.percent ?? 0), 0);

  const setItem = (i: number, patch: Partial<EditorItem>) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const setRequest = (i: number, patch: Partial<EditorRequest>) => setRequests((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    if (validItems.length === 0) return void toast.error("Add at least one item.");
    if (!balanced) return void toast.error("The payment requests must add up to the total.");
    if (!billTo.name.trim()) return void toast.error("Who is the invoice for? Fill in Bill to.");
    setBusy(true);
    const payload = {
      projectId,
      issueDate,
      currency,
      billToName: billTo.name,
      billToAddress: billTo.address,
      billToEmail: billTo.email,
      notes,
      kind,
      platform,
      items: validItems.map((i) => ({ description: i.description, quantity: i.quantity!, unitPrice: i.unitPrice! })),
      requests: requests.map((r, i) => ({ label: r.label, amount: amounts[i]!, dueDate: r.dueDate })),
    };
    const res = invoiceId ? await updateInvoice(invoiceId, payload) : await createInvoice(payload);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(invoiceId ? "Draft saved" : "Draft created");
    const id = invoiceId ?? (res.data as { id: string }).id;
    router.push(`/invoices/${id}`);
    router.refresh();
  };

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <FormSection title="Bill to" description="Starts from the client's billing details — change them for this invoice only.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" htmlFor="inv-bill-name" required>
            <Input id="inv-bill-name" value={billTo.name} onChange={(e) => setBillTo({ ...billTo, name: e.target.value })} />
          </FormField>
          <FormField label="Email" htmlFor="inv-bill-email">
            <Input id="inv-bill-email" type="email" value={billTo.email} onChange={(e) => setBillTo({ ...billTo, email: e.target.value })} />
          </FormField>
          <FormField label="Address" htmlFor="inv-bill-address" className="sm:col-span-2">
            <Textarea id="inv-bill-address" rows={2} value={billTo.address} onChange={(e) => setBillTo({ ...billTo, address: e.target.value })} />
          </FormField>
        </div>
      </FormSection>
      <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
        <FormField label="Issue date" htmlFor="inv-date" required>
          <DatePicker id="inv-date" value={issueDate} onChange={setIssueDate} className="w-full" />
        </FormField>
        <FormField label="Currency" htmlFor="inv-currency" hint="Starts from the project. Amounts below are in this currency.">
          <SelectField id="inv-currency" value={currency} onChange={(v) => setCurrency(v as Currency)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} className="sm:w-[200px]" />
        </FormField>
        <FormField label="Notes" htmlFor="inv-notes" hint="Printed on the invoice.">
          <Textarea id="inv-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        <FormField label="Type" htmlFor="inv-kind">
          <SelectField
            id="inv-kind"
            value={kind}
            onChange={(v) => setKind((v || null) as Kind | null)}
            noneLabel="Not set"
            options={INVOICE_KINDS.map((k) => ({ value: k, label: INVOICE_KIND_LABELS[k] }))}
          />
        </FormField>
        <FormField
          label="Paid via"
          htmlFor="inv-platform"
          hint={platform === "xendit" ? "Each payment request gets a Xendit link; payments are recorded automatically." : "No payment links. Sales uploads the proof of payment and Finance verifies it."}
        >
          <SelectField id="inv-platform" value={platform} onChange={(v) => setPlatform(v as Platform)} options={PAYMENT_PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))} />
        </FormField>
      </div>

      <FormSection title="Items" description={`Amounts in ${currency}. No tax in Phase 1.`}>
        <div className="flex flex-col gap-2">
          <div className="text-muted-foreground hidden grid-cols-[1fr_90px_160px_140px_32px] gap-2 px-1 text-caption sm:grid">
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit price</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          {items.map((item, i) => (
            <div key={i} className="grid grid-cols-[1fr_90px] gap-2 sm:grid-cols-[1fr_90px_160px_140px_32px]">
              <Input aria-label={`Item ${i + 1} description`} value={item.description} onChange={(e) => setItem(i, { description: e.target.value })} placeholder="Design phase" />
              <AmountInput aria-label={`Item ${i + 1} quantity`} value={item.quantity} onChange={(v) => setItem(i, { quantity: v })} className="text-right" />
              <AmountInput aria-label={`Item ${i + 1} unit price`} value={item.unitPrice} onChange={(v) => setItem(i, { unitPrice: v })} decimals={decimals} className="text-right" />
              <span className="tabular flex items-center justify-end text-body">
                {item.quantity && item.unitPrice !== null ? money(itemAmount({ quantity: item.quantity, unitPrice: item.unitPrice }, currency)) : "—"}
              </span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove item" disabled={items.length === 1} onClick={() => setItems((l) => l.filter((_, j) => j !== i))}>
                <Icon name="close" size={14} />
              </Button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button type="button" variant="ghost" size="sm" onClick={() => setItems((l) => [...l, { description: "", quantity: 1, unitPrice: null }])} leadingIcon={icons.add}>
              Add item
            </Button>
            <p className="text-body">
              Total <span className="tabular ml-2 text-subtitle font-medium">{money(total)}</span>
            </p>
          </div>
        </div>
      </FormSection>

      <FormSection
        title="Payment requests"
        description="Split the total into installments, e.g. a 50% Down Payment and a 50% Final Payment. Each gets its own Xendit payment link."
        action={
          <div className="bg-accent inline-flex gap-1 rounded-lg p-1" role="radiogroup" aria-label="Enter as">
            {[true, false].map((pct) => (
              <button
                key={String(pct)}
                type="button"
                role="radio"
                aria-checked={byPercent === pct}
                onClick={() => {
                  if (pct === byPercent) return;
                  if (pct) setRequests((l) => l.map((r, i) => ({ ...r, percent: total > 0 ? Math.round(((amounts[i] ?? 0) / total) * 10000) / 100 : null })));
                  else setRequests((l) => l.map((r, i) => ({ ...r, amount: amounts[i] ?? null })));
                  setByPercent(pct);
                }}
                className={cn("rounded-md px-2.5 py-0.5 text-caption", byPercent === pct ? "bg-background shadow-sm" : "text-muted-foreground")}
              >
                {pct ? "%" : currency}
              </button>
            ))}
          </div>
        }
      >
        <div className="flex flex-col gap-2">
          {requests.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px] gap-2 sm:grid-cols-[1fr_120px_180px_140px_32px]">
              <Input aria-label={`Request ${i + 1} label`} value={r.label} onChange={(e) => setRequest(i, { label: e.target.value })} placeholder="Down Payment" />
              {byPercent ? (
                <AmountInput aria-label={`Request ${i + 1} percent`} value={r.percent} onChange={(v) => setRequest(i, { percent: v })} prefix="%" className="text-right" />
              ) : (
                <AmountInput aria-label={`Request ${i + 1} amount`} value={r.amount} onChange={(v) => setRequest(i, { amount: v })} decimals={decimals} className="text-right" />
              )}
              <DatePicker aria-label={`Request ${i + 1} due date`} value={r.dueDate} onChange={(v) => setRequest(i, { dueDate: v })} className="w-full" />
              <span className="tabular flex items-center justify-end text-body">{money(amounts[i] ?? 0)}</span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove request" disabled={requests.length === 1} onClick={() => setRequests((l) => l.filter((_, j) => j !== i))}>
                <Icon name="close" size={14} />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setRequests((l) => [...l, { label: "", amount: null, percent: null, dueDate: l.at(-1)?.dueDate ?? issueDate }])} leadingIcon={icons.add}>
                Add request
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setByPercent(true);
                  setRequests([
                    { label: "Down Payment", percent: 50, amount: null, dueDate: requests[0]?.dueDate ?? issueDate },
                    { label: "Final Payment", percent: 50, amount: null, dueDate: requests[1]?.dueDate ?? requests[0]?.dueDate ?? issueDate },
                  ]);
                }}
              >
                Split 50 / 50
              </Button>
            </div>
            <p className={cn("text-body", balanced ? "text-muted-foreground" : "text-destructive")} role="status">
              {byPercent ? `${percentSum}% · ` : ""}
              {money(allocated)} of {money(total)}
              {balanced ? " — balanced" : " — must equal the total"}
            </p>
          </div>
        </div>
      </FormSection>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="tertiary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="button" disabled={busy || !balanced} onClick={save}>
          {busy ? "Saving…" : invoiceId ? "Save draft" : "Create draft"}
        </Button>
      </div>
    </div>
  );
}
