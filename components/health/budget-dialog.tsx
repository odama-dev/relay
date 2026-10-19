"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { budgetSchema, ROLLOVER_MODES, type BudgetInput } from "@/lib/validation";
import { updateBudget } from "@/app/(app)/projects/actions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { AmountInput } from "@/components/amount-input";

/** M1.3 / M4.2 — hours, retainer rollover and alert thresholds of one project. */
export function BudgetDialog({
  open,
  onOpenChange,
  projectId,
  retainer,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  retainer: boolean;
  initial: BudgetInput;
}) {
  const router = useRouter();
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<BudgetInput>({ resolver: zodResolver(budgetSchema), defaultValues: initial });
  const mode = useWatch({ control, name: "rolloverMode" });

  const onSubmit = handleSubmit(async (values) => {
    const res = await updateBudget(projectId, values);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Budget saved");
    onOpenChange(false);
    router.refresh();
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Budget & alerts</DialogTitle>
            <DialogDescription>
              {retainer
                ? "Monthly hours and rollover apply from the current month; past months keep their settings."
                : "Total hours for the whole project. Leave empty to only track hours."}
            </DialogDescription>
          </DialogHeader>
          {retainer ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Hours per month" htmlFor="b-retainer" required error={errors.retainerHoursPerMonth?.message}>
                <Controller control={control} name="retainerHoursPerMonth" render={({ field }) => <AmountInput id="b-retainer" value={field.value} onChange={field.onChange} />} />
              </FormField>
              <FormField label="Rollover" htmlFor="b-rollover">
                <Controller
                  control={control}
                  name="rolloverMode"
                  render={({ field }) => (
                    <SelectField
                      id="b-rollover"
                      value={field.value}
                      onChange={field.onChange}
                      options={ROLLOVER_MODES.map((m) => ({ value: m, label: m === "none" ? "None — unused hours lapse" : m === "full" ? "Full — carry everything" : "Capped — carry up to a cap" }))}
                    />
                  )}
                />
              </FormField>
              {mode === "capped" && (
                <FormField label="Rollover cap (hours)" htmlFor="b-cap" required error={errors.rolloverCapHours?.message}>
                  <Controller control={control} name="rolloverCapHours" render={({ field }) => <AmountInput id="b-cap" value={field.value} onChange={field.onChange} />} />
                </FormField>
              )}
            </div>
          ) : (
            <FormField label="Budget (hours)" htmlFor="b-hours">
              <Controller control={control} name="budgetHours" render={({ field }) => <AmountInput id="b-hours" value={field.value} onChange={field.onChange} />} />
            </FormField>
          )}
          <Controller
            control={control}
            name="alertThresholds"
            render={({ field }) => (
              <FormField
                label="Alert thresholds (%)"
                htmlFor="b-thresholds"
                error={errors.alertThresholds?.message ?? errors.alertThresholds?.[0]?.message}
                hint="The PM and C-Level get one Slack DM per threshold per period. e.g. 50, 80, 100"
              >
                <Input
                  id="b-thresholds"
                  defaultValue={field.value.join(", ")}
                  onChange={(e) => field.onChange(e.target.value.split(/[,\s]+/).filter(Boolean).map(Number))}
                />
              </FormField>
            )}
          />
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save budget"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
