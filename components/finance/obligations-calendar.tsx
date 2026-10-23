"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import type { ObligationKind } from "@prisma/client";
import type { ObligationItem, ObligationRow } from "@/lib/finance/ops";
import { OBLIGATION_KIND_LABELS } from "@/lib/finance/obligations";
import { addMonths, monthStart, type IsoDate } from "@/lib/time/pure";
import { formatDateShort, formatMoney } from "@/lib/format";
import { CURRENCIES, OBLIGATION_KINDS, OBLIGATION_RECURRENCES, type ObligationInput } from "@/lib/validation";
import { createObligation, setObligationDone, updateObligation } from "@/app/(app)/finance/actions";
import { CalendarChip, CalendarHeader, Dot, MonthGrid, MoreDots, monthTitle } from "@/components/calendar/month-grid";
import { badgeColors } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckField } from "@/components/check-field";
import { FormField } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { DatePicker } from "@/components/date-picker";
import { AmountInput } from "@/components/amount-input";
import { RowActions } from "@/components/row-actions";
import { icons } from "@/components/icon";
import { cn } from "@/lib/utils";

/** Dot colour per kind; invoice due dates are dashed chips. */
const KIND_COLOR: Record<ObligationKind | "invoice", string> = {
  payroll: badgeColors.blue,
  bpjs: badgeColors.teal,
  tax: badgeColors.purple,
  other: "var(--muted-foreground)",
  invoice: badgeColors.amber,
};
const KIND_LABEL: Record<ObligationKind | "invoice", string> = { ...OBLIGATION_KIND_LABELS, invoice: "Invoice due" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const RECURRENCE_LABEL = { monthly: "Every month", yearly: "Every year", once: "Once" } as const;

/**
 * Kalender kewajiban (PRD Phase 2 "Finance"): payroll, BPJS, tax deadlines
 * and invoice due dates on a month grid, then the month as a checklist —
 * tick an obligation once it's paid or filed. `manageable` lists the kinds
 * this person keeps (Finance: all; People: payroll and BPJS).
 */
export function ObligationsCalendar({
  month,
  today,
  items,
  obligations,
  manageable,
  param = "omonth",
}: {
  month: IsoDate;
  today: IsoDate;
  items: ObligationItem[];
  obligations: ObligationRow[];
  manageable: ObligationKind[];
  param?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [day, setDay] = useState<IsoDate | null>(null);
  const [managing, setManaging] = useState(false);

  const goMonth = (m: IsoDate) => {
    const next = new URLSearchParams(params.toString());
    if (m === monthStart(today)) next.delete(param);
    else next.set(param, m.slice(0, 7));
    start(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  };
  const canTick = (it: ObligationItem) => it.kind !== "invoice" && manageable.includes(it.kind);
  const toggle = async (it: ObligationItem, done: boolean) => {
    const res = await setObligationDone({ obligationId: it.obligationId, dueDate: it.startDate, done });
    if (!res.ok) return void toast.error(res.error);
    router.refresh();
  };
  const inMonth = items.filter((it) => it.startDate.slice(0, 7) === month.slice(0, 7));
  const open = inMonth.filter((it) => !it.done && it.kind !== "invoice");

  return (
    <section aria-label="Obligations" className="flex flex-col">
      <CalendarHeader
        title={`Obligations · ${monthTitle(month)}`}
        pending={pending}
        unit="month"
        onToday={() => goMonth(monthStart(today))}
        onStep={(n) => goMonth(addMonths(month, n))}
        actions={
          manageable.length > 0 && (
            <Button variant="secondary" size="compact" leadingIcon={icons.settings} onClick={() => setManaging(true)}>
              Manage
            </Button>
          )
        }
      >
        <span className="text-muted-foreground hidden flex-wrap items-center gap-3 text-caption md:flex">
          {(Object.keys(KIND_COLOR) as (keyof typeof KIND_COLOR)[]).map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <Dot color={KIND_COLOR[k]} />
              {KIND_LABEL[k]}
            </span>
          ))}
        </span>
      </CalendarHeader>
      <div className="grid gap-0 border-t lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-h-[520px] flex-col lg:border-r">
          <MonthGrid
            month={month}
            today={today}
            items={items}
            pending={pending}
            renderMore={(d, hidden) => (
              <MoreDots dots={hidden.map((s) => ({ key: s.item.key, color: KIND_COLOR[s.item.kind] }))} label={`${hidden.length} more on ${formatDateShort(d)}`} onClick={() => setDay(d)} />
            )}
            onDay={setDay}
            dayLabel={(d) => `Show ${formatDateShort(d)}`}
            renderChip={(seg) => (
              <CalendarChip
                key={seg.item.key}
                seg={seg}
                title={seg.item.title}
                past={seg.item.done}
                dashed={seg.item.kind === "invoice"}
                fill={seg.item.kind === "invoice" ? undefined : { backgroundColor: "var(--accent)", borderColor: "var(--border)" }}
                leading={<Dot color={KIND_COLOR[seg.item.kind]} />}
                onOpen={() => (seg.item.href ? router.push(seg.item.href) : setDay(seg.item.startDate))}
                clickable
              />
            )}
          />
        </div>
        <div className="flex flex-col gap-2 p-4">
          <h3 className="flex items-center justify-between text-body font-medium">
            This month
            <span className="text-muted-foreground text-caption">{open.length ? `${open.length} to do` : "All done"}</span>
          </h3>
          <AgendaList items={inMonth} today={today} canTick={canTick} onToggle={toggle} />
        </div>
      </div>
      {day && (
        <Dialog open onOpenChange={(o) => !o && setDay(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{formatDateShort(day)}</DialogTitle>
              <DialogDescription>Obligations and invoice due dates on this day.</DialogDescription>
            </DialogHeader>
            <AgendaList items={items.filter((it) => it.startDate === day)} today={today} canTick={canTick} onToggle={toggle} empty="Nothing due on this day." />
          </DialogContent>
        </Dialog>
      )}
      {managing && <ManageDialog obligations={obligations} manageable={manageable} onClose={() => setManaging(false)} />}
    </section>
  );
}

function AgendaList({
  items,
  today,
  canTick,
  onToggle,
  empty = "Nothing due this month.",
}: {
  items: ObligationItem[];
  today: IsoDate;
  canTick: (it: ObligationItem) => boolean;
  onToggle: (it: ObligationItem, done: boolean) => void;
  empty?: string;
}) {
  if (!items.length) return <p className="text-muted-foreground text-body">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1 text-body">
      {items.map((it) => {
        const late = !it.done && it.startDate < today;
        const amount = it.amount !== null && it.currency ? formatMoney(it.amount, it.currency) : null;
        const label = (
          <span className="flex min-w-0 flex-col">
            <span className={cn("truncate", it.done && "text-muted-foreground line-through")}>{it.title}</span>
            <span className={cn("text-caption", late ? "text-destructive" : "text-muted-foreground")}>
              {formatDateShort(it.startDate)} · {KIND_LABEL[it.kind]}
              {amount && ` · ${amount}`}
              {late && " · past due"}
            </span>
          </span>
        );
        return (
          <li key={it.key} className="hover:bg-accent/40 flex items-start gap-2 rounded-lg px-2 py-1.5">
            {it.kind === "invoice" ? (
              <>
                <span className="mt-1.5">
                  <Dot color={KIND_COLOR.invoice} />
                </span>
                <Link href={it.href!} className="min-w-0 flex-1 hover:underline">
                  {label}
                </Link>
              </>
            ) : (
              <CheckField id={`ob-${it.key}`} checked={it.done} disabled={!canTick(it)} onChange={(v) => onToggle(it, v)} label={label} className="min-w-0 flex-1" />
            )}
          </li>
        );
      })}
    </ul>
  );
}

type Draft = ObligationInput & { id?: string };
const EMPTY: Draft = { title: "", kind: "tax", recurrence: "monthly", dayOfMonth: 15, month: null, onDate: "", amountEstimate: null, currency: "IDR", notes: "", isActive: true };

function describe(o: ObligationRow) {
  if (o.recurrence === "once") return `Once, ${o.onDate ? formatDateShort(o.onDate) : "—"}`;
  if (o.recurrence === "yearly") return `Every year, ${o.dayOfMonth} ${MONTHS[(o.month ?? 1) - 1]}`;
  return `Every month on the ${o.dayOfMonth}${o.dayOfMonth === 1 || o.dayOfMonth === 21 || o.dayOfMonth === 31 ? "st" : o.dayOfMonth === 2 || o.dayOfMonth === 22 ? "nd" : o.dayOfMonth === 3 || o.dayOfMonth === 23 ? "rd" : "th"}`;
}

/** Add, edit or switch off obligations. Switched-off ones stay listed, greyed. */
function ManageDialog({ obligations, manageable, onClose }: { obligations: ObligationRow[]; manageable: ObligationKind[]; onClose: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    const { id, ...values } = draft;
    const res = id ? await updateObligation(id, values) : await createObligation(values);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(id ? "Obligation saved" : "Obligation added");
    setDraft(null);
    router.refresh();
  };
  const toggleActive = async (o: ObligationRow) => {
    const res = await updateObligation(o.id, { ...o, onDate: o.onDate ?? "", notes: o.notes ?? "", isActive: !o.isActive });
    if (!res.ok) return void toast.error(res.error);
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="lg" className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Obligations</DialogTitle>
          <DialogDescription>Recurring payments and deadlines. Set the studio&apos;s own tax dates here; payroll and BPJS also show on the HR calendar.</DialogDescription>
        </DialogHeader>
        {draft ? (
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
              <FormField label="Name" htmlFor="ob-title" required>
                <Input id="ob-title" value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. PPN payment" />
              </FormField>
              <FormField label="Kind" htmlFor="ob-kind">
                <SelectField
                  id="ob-kind"
                  value={draft.kind}
                  onChange={(v) => set({ kind: v as ObligationKind })}
                  options={OBLIGATION_KINDS.filter((k) => manageable.includes(k)).map((k) => ({ value: k, label: OBLIGATION_KIND_LABELS[k] }))}
                />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Repeats" htmlFor="ob-rec">
                <SelectField
                  id="ob-rec"
                  value={draft.recurrence}
                  onChange={(v) => set({ recurrence: v as Draft["recurrence"], month: v === "yearly" ? (draft.month ?? 1) : null })}
                  options={OBLIGATION_RECURRENCES.map((r) => ({ value: r, label: RECURRENCE_LABEL[r] }))}
                />
              </FormField>
              {draft.recurrence === "once" ? (
                <FormField label="Date" htmlFor="ob-date" required>
                  <DatePicker id="ob-date" value={draft.onDate ?? ""} onChange={(v) => set({ onDate: v, dayOfMonth: Number(v.slice(8, 10)) || 1 })} className="w-full" />
                </FormField>
              ) : (
                <FormField label="Day of month" htmlFor="ob-day" hint="A short month uses its last day.">
                  <Input id="ob-day" type="number" min={1} max={31} value={draft.dayOfMonth} onChange={(e) => set({ dayOfMonth: Number(e.target.value) })} />
                </FormField>
              )}
              {draft.recurrence === "yearly" && (
                <FormField label="Month" htmlFor="ob-month">
                  <SelectField id="ob-month" value={String(draft.month ?? 1)} onChange={(v) => set({ month: Number(v) })} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
                </FormField>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <FormField label="Usual amount" htmlFor="ob-amount" hint="Optional, for planning.">
                <AmountInput id="ob-amount" value={draft.amountEstimate ?? null} onChange={(v) => set({ amountEstimate: v })} decimals={draft.currency === "IDR" ? 0 : 2} />
              </FormField>
              <FormField label="Currency" htmlFor="ob-cur">
                <SelectField id="ob-cur" value={draft.currency ?? "IDR"} onChange={(v) => set({ currency: v as Draft["currency"] })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
              </FormField>
            </div>
            <FormField label="Notes" htmlFor="ob-notes">
              <Input id="ob-notes" value={draft.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} />
            </FormField>
          </div>
        ) : (
          <ul className="flex flex-col gap-1 text-body">
            {obligations.map((o) => {
              const editable = manageable.includes(o.kind);
              return (
                <li key={o.id} className={cn("hover:bg-accent/40 flex items-center gap-3 rounded-lg px-2 py-1.5", !o.isActive && "text-muted-foreground")}>
                  <Dot color={KIND_COLOR[o.kind]} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{o.title}</span>
                    <span className="text-muted-foreground text-caption">
                      {o.kindLabel} · {describe(o)}
                      {o.amountEstimate !== null && ` · ${formatMoney(o.amountEstimate, o.currency)}`}
                      {!o.isActive && " · off"}
                    </span>
                  </span>
                  {editable && (
                    <RowActions
                      label={`${o.title} actions`}
                      actions={[
                        { label: "Edit", icon: "edit", onSelect: () => setDraft({ ...o, onDate: o.onDate ?? "", notes: o.notes ?? "", currency: o.currency as Draft["currency"] }) },
                        { label: o.isActive ? "Switch off" : "Switch on", icon: o.isActive ? "archive" : "restore", onSelect: () => void toggleActive(o) },
                      ]}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <DialogFooter className="sm:justify-between">
          {draft ? (
            <>
              <Button variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
                Back
              </Button>
              <Button onClick={save} disabled={busy || !draft.title.trim()}>
                {busy ? "Saving…" : draft.id ? "Save" : "Add obligation"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" leadingIcon={icons.add} onClick={() => setDraft({ ...EMPTY, kind: manageable.includes("tax") ? "tax" : manageable[0]! })}>
                Add obligation
              </Button>
              <Button variant="tertiary" onClick={onClose}>
                Close
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
