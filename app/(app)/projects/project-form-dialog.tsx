"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import { CONTRACT_TYPES, CURRENCIES, ROLLOVER_MODES, projectSchema, type ProjectInput } from "@/lib/validation";
import { humanizeEnum } from "@/lib/format";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FormField, FormSection, fieldA11y } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { DatePicker } from "@/components/date-picker";
import { AmountInput } from "@/components/amount-input";
import { cn } from "@/lib/utils";
import { createProject, updateProject } from "./actions";

type Output = z.output<typeof projectSchema>;
export type ClientChoice = { id: string; code: string; name: string; defaultCurrency: string };
export type PmChoice = { id: string; name: string };

const ROLLOVER_HINT = {
  none: "Unused hours lapse at month end.",
  full: "All unused hours carry into next month.",
  capped: "Unused hours carry over, up to a cap.",
};

export function ProjectFormDialog({
  open,
  onOpenChange,
  clients,
  pms,
  canEditContract,
  defaults,
  project,
  dealId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: ClientChoice[];
  pms: PmChoice[];
  canEditContract: boolean;
  /** New project: prefilled values (e.g. the creator as PM, default thresholds). */
  defaults: ProjectInput;
  /** Present when editing. */
  project?: { id: string; code: string };
  /** A won deal this new project comes from (Phase 2 · M9). */
  dealId?: string;
  /** New project: stay where you are (e.g. a client panel) instead of opening the project. */
  onCreated?: (project: { id: string; code: string }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <ProjectForm
          clients={clients}
          pms={pms}
          canEditContract={canEditContract}
          defaults={defaults}
          project={project}
          dealId={dealId}
          onCreated={onCreated}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ProjectForm({
  clients,
  pms,
  canEditContract,
  defaults,
  project,
  dealId,
  onCreated,
  onDone,
}: {
  clients: ClientChoice[];
  pms: PmChoice[];
  canEditContract: boolean;
  defaults: ProjectInput;
  project?: { id: string; code: string };
  dealId?: string;
  onCreated?: (project: { id: string; code: string }) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const editing = Boolean(project);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ProjectInput, unknown, Output>({ resolver: zodResolver(projectSchema), defaultValues: defaults });

  const kind = useWatch({ control, name: "kind" });
  const contractType = useWatch({ control, name: "contractType" });
  const rollover = useWatch({ control, name: "budget.rolloverMode" });
  const currency = useWatch({ control, name: "currency" });
  const isClient = kind === "client";
  const retainer = isClient && contractType === "retainer";
  // Total hour budget is opt-in (retainers always have monthly hours).
  const [hasBudget, setHasBudget] = useState(defaults.budget.budgetHours != null);

  const onSubmit = handleSubmit(async (values) => {
    if (project) {
      const res = await updateProject(project.id, values);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Project updated");
      onDone();
      router.refresh();
      return;
    }
    const res = await createProject(values, dealId);
    if (!res.ok) return void toast.error(res.error);
    toast.success(`Project ${res.data.code} created`);
    onDone();
    if (onCreated) onCreated(res.data);
    else router.push(`/projects/${res.data.id}`);
  });

  const err = errors as Record<string, { message?: string } | undefined> & { budget?: Record<string, { message?: string }> };

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6">
      <DialogHeader>
        <DialogTitle>{project ? `Edit ${project.code}` : "New project"}</DialogTitle>
        <DialogDescription>
          {project
            ? "Kind and client are fixed after creation."
            : "The code is generated from the client code (ACM-001), or INT-001 for internal work."}
        </DialogDescription>
      </DialogHeader>

      {!editing && (
        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <div role="radiogroup" aria-label="Project kind" className="bg-accent inline-flex w-fit gap-1 rounded-lg p-1">
              {(["client", "internal"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={field.value === k}
                  onClick={() => field.onChange(k)}
                  className={cn(
                    "rounded-md px-3 py-1 text-body transition-colors",
                    field.value === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {k === "client" ? "Client project" : "Internal project"}
                </button>
              ))}
            </div>
          )}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Project name" htmlFor="pr-name" required error={errors.name?.message} className="sm:col-span-2">
          <Input {...fieldA11y("pr-name", errors.name?.message)} {...register("name")} />
        </FormField>

        {isClient && (
          <FormField label="Client" htmlFor="pr-client" required error={err.clientId?.message}>
            <Controller
              control={control}
              name="clientId"
              render={({ field }) => (
                <SelectField
                  {...fieldA11y("pr-client", err.clientId?.message)}
                  disabled={editing}
                  value={field.value}
                  onChange={(v) => {
                    field.onChange(v);
                    const c = clients.find((x) => x.id === v);
                    if (c && (CURRENCIES as readonly string[]).includes(c.defaultCurrency)) {
                      setValue("currency", c.defaultCurrency as (typeof CURRENCIES)[number]);
                    }
                  }}
                  placeholder="Choose a client"
                  options={clients.map((c) => ({ value: c.id, label: c.name, hint: c.code }))}
                />
              )}
            />
          </FormField>
        )}

        <FormField label="Project manager" htmlFor="pr-pm" required error={errors.pmId?.message} hint={editing ? undefined : "Becomes a member automatically."}>
          <Controller
            control={control}
            name="pmId"
            render={({ field }) => (
              <SelectField
                {...fieldA11y("pr-pm", errors.pmId?.message, !editing)}
                value={field.value}
                onChange={field.onChange}
                placeholder="Choose a PM"
                options={pms.map((p) => ({ value: p.id, label: p.name }))}
              />
            )}
          />
        </FormField>

        {isClient && (
          <FormField label="Contract type" htmlFor="pr-contract" required error={err.contractType?.message}>
            <Controller
              control={control}
              name="contractType"
              render={({ field }) => (
                <SelectField
                  {...fieldA11y("pr-contract", err.contractType?.message)}
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Choose"
                  options={CONTRACT_TYPES.map((t) => ({ value: t, label: t === "time_and_material" ? "Time & material" : humanizeEnum(t) }))}
                />
              )}
            />
          </FormField>
        )}

        <FormField label="Currency" htmlFor="pr-currency" required>
          <Controller
            control={control}
            name="currency"
            render={({ field }) => (
              <SelectField id="pr-currency" value={field.value} onChange={field.onChange} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
            )}
          />
        </FormField>

        {isClient && canEditContract && (
          <FormField label="Contract value" htmlFor="pr-value" error={err.contractValue?.message} hint="Only Sales, Finance, C-Level and the project's PM see this.">
            <Controller
              control={control}
              name="contractValue"
              render={({ field }) => (
                <AmountInput
                  {...fieldA11y("pr-value", err.contractValue?.message, true)}
                  value={field.value}
                  onChange={field.onChange}
                  prefix={currency}
                  decimals={currency === "IDR" ? 0 : 2}
                />
              )}
            />
          </FormField>
        )}

        {retainer && canEditContract && (
          <FormField label="Retainer fee per month" htmlFor="pr-fee" error={err.retainerFeePerMonth?.message} hint="Used for the C-Level forecast and effective rate.">
            <Controller
              control={control}
              name="retainerFeePerMonth"
              render={({ field }) => (
                <AmountInput
                  {...fieldA11y("pr-fee", err.retainerFeePerMonth?.message, true)}
                  value={field.value}
                  onChange={field.onChange}
                  prefix={currency}
                  decimals={currency === "IDR" ? 0 : 2}
                />
              )}
            />
          </FormField>
        )}

        <FormField label="Start date" htmlFor="pr-start" required error={errors.startDate?.message}>
          <Controller
            control={control}
            name="startDate"
            render={({ field }) => <DatePicker id="pr-start" value={field.value} onChange={field.onChange} className="w-full" />}
          />
        </FormField>
        <FormField label="End date" htmlFor="pr-end" error={err.endDate?.message}>
          <Controller
            control={control}
            name="endDate"
            render={({ field }) => <DatePicker id="pr-end" value={field.value} onChange={field.onChange} clearable placeholder="Open-ended" className="w-full" />}
          />
        </FormField>
      </div>

      {!editing && (
        <FormSection
          title="Hour budget"
          description={retainer ? "Monthly hours with rollover. Changes apply from the current month." : "Optional total hours for the whole project."}
          action={
            !retainer && (
              <Switch
                label="Set budget"
                className="px-0"
                checked={hasBudget}
                onToggle={() => {
                  setHasBudget(!hasBudget);
                  if (hasBudget) setValue("budget.budgetHours", null);
                }}
              />
            )
          }
        >
          {(retainer || hasBudget) && (
          <div className="grid gap-4 sm:grid-cols-3">
            {retainer ? (
              <>
                <FormField label="Hours per month" htmlFor="pr-retainer" required error={err.budget?.retainerHoursPerMonth?.message}>
                  <Controller
                    control={control}
                    name="budget.retainerHoursPerMonth"
                    render={({ field }) => <AmountInput id="pr-retainer" value={field.value} onChange={field.onChange} />}
                  />
                </FormField>
                <FormField label="Rollover" htmlFor="pr-rollover" hint={ROLLOVER_HINT[rollover ?? "none"]}>
                  <Controller
                    control={control}
                    name="budget.rolloverMode"
                    render={({ field }) => (
                      <SelectField
                        id="pr-rollover"
                        value={field.value}
                        onChange={field.onChange}
                        options={ROLLOVER_MODES.map((m) => ({ value: m, label: m === "none" ? "None" : m === "full" ? "Full" : "Capped" }))}
                      />
                    )}
                  />
                </FormField>
                {rollover === "capped" && (
                  <FormField label="Cap (hours)" htmlFor="pr-cap" required error={err.budget?.rolloverCapHours?.message}>
                    <Controller
                      control={control}
                      name="budget.rolloverCapHours"
                      render={({ field }) => <AmountInput id="pr-cap" value={field.value} onChange={field.onChange} />}
                    />
                  </FormField>
                )}
              </>
            ) : (
              <FormField label="Budget (hours)" htmlFor="pr-budget">
                <Controller
                  control={control}
                  name="budget.budgetHours"
                  render={({ field }) => <AmountInput id="pr-budget" value={field.value} onChange={field.onChange} />}
                />
              </FormField>
            )}
          </div>
          )}
        </FormSection>
      )}

      <FormSection title="Links" description="Optional.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Notion" htmlFor="pr-notion" error={(errors.links as Record<string, { message?: string }> | undefined)?.notion?.message}>
            <Input id="pr-notion" type="url" placeholder="https://" {...register("links.notion")} />
          </FormField>
          <FormField label="Figma" htmlFor="pr-figma" error={(errors.links as Record<string, { message?: string }> | undefined)?.figma?.message}>
            <Input id="pr-figma" type="url" placeholder="https://" {...register("links.figma")} />
          </FormField>
          <FormField label="Drive" htmlFor="pr-drive" error={(errors.links as Record<string, { message?: string }> | undefined)?.drive?.message}>
            <Input id="pr-drive" type="url" placeholder="https://" {...register("links.drive")} />
          </FormField>
          <FormField label="Slack channel" htmlFor="pr-slack">
            <Input id="pr-slack" placeholder="#acme-website" {...register("links.slack_channel")} />
          </FormField>
        </div>
      </FormSection>

      <DialogFooter>
        <Button type="button" variant="tertiary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : project ? "Save changes" : "Create project"}
        </Button>
      </DialogFooter>
    </form>
  );
}
