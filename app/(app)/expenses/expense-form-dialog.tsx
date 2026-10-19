"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { ExpenseCategory } from "@prisma/client";
import { CURRENCIES, EXPENSE_CATEGORIES, EXPENSE_KINDS, expenseSchema, type ExpenseInput } from "@/lib/validation";
import { EXPENSE_CATEGORY_LABELS, EXPENSE_KIND_LABELS, defaultKind } from "@/lib/expenses/pure";
import { currencyDecimals } from "@/lib/format";
import { useOpenFromUrl } from "@/lib/hooks/use-open-from-url";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, fieldA11y } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { DatePicker } from "@/components/date-picker";
import { AmountInput } from "@/components/amount-input";
import { PillButton } from "@/components/pill-button";
import { Icon, icons } from "@/components/icon";
import { createExpense, removeReceipt, updateExpense } from "./actions";

export type ExpenseDraft = { id: string; values: ExpenseInput; receiptName: string | null };
type Currency = ExpenseInput["currency"];

const RECEIPT_ACCEPT = "application/pdf,image/png,image/jpeg,image/gif,image/webp";

type ProjectOption = { value: string; label: string };

export function RecordExpenseButton({ today, currency, projects }: { today: string; currency: Currency; projects: ProjectOption[] }) {
  const [open, setOpen] = useOpenFromUrl();
  return (
    <>
      <PillButton onClick={() => setOpen(true)}>Record expense</PillButton>
      <ExpenseFormDialog open={open} onOpenChange={setOpen} today={today} currency={currency} projects={projects} />
    </>
  );
}

export function ExpenseFormDialog({
  open,
  onOpenChange,
  expense,
  today,
  currency,
  projects,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense?: ExpenseDraft;
  today: string;
  currency: Currency;
  projects: ProjectOption[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        {open && <ExpenseForm expense={expense} today={today} currency={currency} projects={projects} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

async function uploadReceipt(id: string, file: File): Promise<string | null> {
  const body = new FormData();
  body.set("file", file);
  const res = await fetch(`/api/expenses/${id}/receipt`, { method: "POST", body });
  if (res.ok) return null;
  return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "The receipt couldn't be uploaded.";
}

function ExpenseForm({ expense, today, currency, projects, onDone }: { expense?: ExpenseDraft; today: string; currency: Currency; projects: ProjectOption[]; onDone: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dropReceipt, setDropReceipt] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    getFieldState,
    formState: { errors, isSubmitting },
  } = useForm<ExpenseInput>({
    resolver: zodResolver(expenseSchema),
    defaultValues: expense?.values ?? { expenseDate: today, vendor: "", description: "", category: "software", kind: "opex", amount: undefined as unknown as number, currency, notes: "", projectId: "" },
  });
  const selectedCurrency = useWatch({ control, name: "currency" });
  const existingReceipt = expense?.receiptName && !dropReceipt ? expense.receiptName : null;

  const onSubmit = handleSubmit(async (values) => {
    let id = expense?.id;
    if (id) {
      const res = await updateExpense(id, values);
      if (!res.ok) return void toast.error(res.error);
    } else {
      const res = await createExpense(values);
      if (!res.ok) return void toast.error(res.error);
      id = res.data.id;
    }
    if (file) {
      const error = await uploadReceipt(id, file);
      if (error) toast.error(`Expense saved, but ${error.charAt(0).toLowerCase()}${error.slice(1)}`);
    } else if (dropReceipt && expense?.receiptName) {
      const res = await removeReceipt(id);
      if (!res.ok) toast.error(res.error);
    }
    toast.success(expense ? "Expense updated" : "Expense recorded");
    onDone();
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{expense ? "Edit expense" : "Record expense"}</DialogTitle>
        <DialogDescription>A subscription renewal, a utility bill, equipment — one entry per payment.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <FormField label="Date" htmlFor="e-date" required error={errors.expenseDate?.message}>
          <Controller control={control} name="expenseDate" render={({ field }) => <DatePicker id="e-date" value={field.value} onChange={field.onChange} className="w-full" />} />
        </FormField>
        <FormField label="Vendor" htmlFor="e-vendor" required error={errors.vendor?.message}>
          <Input {...fieldA11y("e-vendor", errors.vendor?.message)} placeholder="Figma, PLN, Biznet…" autoComplete="off" {...register("vendor")} />
        </FormField>
      </div>
      <FormField label="Description" htmlFor="e-desc" error={errors.description?.message}>
        <Input id="e-desc" placeholder="Professional plan, 3 seats · October" {...register("description")} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        <FormField label="Category" htmlFor="e-category" required error={errors.category?.message}>
          <Controller
            control={control}
            name="category"
            render={({ field }) => (
              <SelectField
                id="e-category"
                value={field.value}
                onChange={(v) => {
                  field.onChange(v);
                  // Follow the category until the user picks the type themselves.
                  if (!getFieldState("kind").isDirty) setValue("kind", defaultKind(v as ExpenseCategory));
                }}
                options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABELS[c] }))}
              />
            )}
          />
        </FormField>
        <FormField label="Type" htmlFor="e-kind" required hint="Capex: kept as an asset." error={errors.kind?.message}>
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <SelectField
                id="e-kind"
                value={field.value}
                onChange={(v) => setValue("kind", v as ExpenseInput["kind"], { shouldDirty: true })}
                options={EXPENSE_KINDS.map((k) => ({ value: k, label: EXPENSE_KIND_LABELS[k] }))}
              />
            )}
          />
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <FormField label="Amount" htmlFor="e-amount" required error={errors.amount?.message}>
          <Controller
            control={control}
            name="amount"
            render={({ field }) => (
              <AmountInput
                {...fieldA11y("e-amount", errors.amount?.message)}
                value={field.value}
                onChange={(v) => field.onChange(v ?? undefined)}
                decimals={currencyDecimals(selectedCurrency)}
                className="text-right"
              />
            )}
          />
        </FormField>
        <FormField label="Currency" htmlFor="e-currency" required>
          <Controller
            control={control}
            name="currency"
            render={({ field }) => <SelectField id="e-currency" value={field.value} onChange={field.onChange} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />}
          />
        </FormField>
      </div>
      <FormField label="Receipt" htmlFor="e-receipt" hint="PDF or image, up to 10 MB.">
        <input
          ref={fileRef}
          id="e-receipt"
          type="file"
          accept={RECEIPT_ACCEPT}
          className="sr-only"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setDropReceipt(false);
          }}
        />
        <div className="flex min-h-9 items-center gap-2 text-body">
          {file || existingReceipt ? (
            <>
              <Icon name="file" size={14} className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{file?.name ?? existingReceipt}</span>
              <Button
                type="button"
                variant="ghost"
                size="compact"
                onClick={() => {
                  if (file) {
                    setFile(null);
                    if (fileRef.current) fileRef.current.value = "";
                  } else setDropReceipt(true);
                }}
              >
                Remove
              </Button>
            </>
          ) : (
            <Button type="button" variant="tertiary" size="sm" onClick={() => fileRef.current?.click()} leadingIcon={icons.upload}>
              Attach receipt
            </Button>
          )}
        </div>
      </FormField>
      <FormField label="Project" htmlFor="e-project" hint="Only for a cost of one project, e.g. a freelancer. It counts in that project's margin.">
        <Controller
          control={control}
          name="projectId"
          render={({ field }) => (
            <SelectField id="e-project" value={field.value ?? ""} onChange={field.onChange} noneLabel="Studio-wide" options={projects} />
          )}
        />
      </FormField>
      <FormField label="Notes" htmlFor="e-notes">
        <Textarea id="e-notes" rows={2} {...register("notes")} />
      </FormField>
      <DialogFooter>
        <Button type="button" variant="tertiary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : expense ? "Save changes" : "Record expense"}
        </Button>
      </DialogFooter>
    </form>
  );
}
