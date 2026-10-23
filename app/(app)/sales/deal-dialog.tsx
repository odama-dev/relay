"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import type { DealView, StageView } from "@/lib/sales/queries";
import { currencyDecimals, formatDate } from "@/lib/format";
import { CURRENCIES, dealSchema, type DealInput } from "@/lib/validation";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, fieldA11y } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { DatePicker } from "@/components/date-picker";
import { AmountInput } from "@/components/amount-input";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { ProjectFormDialog, type ClientChoice, type PmChoice } from "@/app/(app)/projects/project-form-dialog";
import { createClientFromDeal, createDeal, deleteDeal, updateDeal } from "./actions";

type Output = z.output<typeof dealSchema>;

export type SalesChoices = {
  stages: StageView[];
  clients: ClientChoice[];
  people: { id: string; name: string }[];
  pms: PmChoice[];
  canManage: boolean;
  canCreateProject: boolean;
  canAddClient: boolean;
  canEditContract: boolean;
  thresholds: number[];
  defaultPmId: string;
  today: string;
  userId: string;
};

/** Suggested client code from a company name: its first letters, 2–6 capitals. */
const suggestCode = (name: string) => {
  const words = name.toUpperCase().replace(/[^A-Z ]/g, "").split(/\s+/).filter(Boolean);
  const code = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "");
  return code.slice(0, 6).padEnd(2, "X");
};

/**
 * Create or edit a deal (PRD Phase 2 "Pipeline"). A won deal offers the next
 * step: add the prospect as a client, then create its project with the
 * deal's value as the contract value.
 */
export function DealDialog({ deal, choices, initialStageId, onClose }: { deal?: DealView; choices: SalesChoices; initialStageId?: string; onClose: () => void }) {
  const router = useRouter();
  const firstOpen = choices.stages.find((s) => s.category === "open") ?? choices.stages[0]!;
  const startStage = choices.stages.find((s) => s.id === initialStageId) ?? firstOpen;
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<DealInput, unknown, Output>({
    resolver: zodResolver(dealSchema),
    defaultValues: deal
      ? {
          title: deal.title,
          clientId: deal.client?.id ?? "",
          prospectName: deal.prospectName ?? "",
          value: deal.value,
          currency: deal.currency as (typeof CURRENCIES)[number],
          probability: deal.probability,
          expectedClose: deal.expectedClose ?? "",
          ownerId: deal.owner?.id ?? "",
          leadSource: deal.leadSource ?? "",
          serviceType: deal.serviceType ?? "",
          stageId: deal.stageId,
          lostReason: deal.lostReason ?? "",
          notes: deal.notes ?? "",
        }
      : {
          title: "",
          clientId: "",
          prospectName: "",
          value: undefined as unknown as number,
          currency: "IDR",
          probability: startStage.probability,
          expectedClose: "",
          ownerId: choices.userId,
          leadSource: "",
          serviceType: "",
          stageId: startStage.id,
          lostReason: "",
          notes: "",
        },
  });
  const clientId = useWatch({ control, name: "clientId" });
  const stageId = useWatch({ control, name: "stageId" });
  const currency = useWatch({ control, name: "currency" });
  const stage = choices.stages.find((s) => s.id === stageId);
  const readOnly = !choices.canManage;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const onSubmit = handleSubmit(async (values) => {
    const res = deal ? await updateDeal(deal.id, values) : await createDeal(values);
    if (!res.ok) return void toast.error(res.error);
    toast.success(deal ? "Deal saved" : "Deal added");
    onClose();
    router.refresh();
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{deal ? deal.title : "New deal"}</DialogTitle>
            <DialogDescription>
              {deal ? `In ${choices.stages.find((s) => s.id === deal.stageId)?.name ?? "its stage"} since ${formatDate(deal.stageSince)}.` : "A lead or opportunity. It becomes a client and a project once it's won."}
            </DialogDescription>
          </DialogHeader>

          {deal && stage?.category === "won" && <WonNextStep deal={deal} choices={choices} onDone={onClose} />}

          <fieldset disabled={readOnly} className="grid gap-4">
            <FormField label="Deal" htmlFor="d-title" required error={errors.title?.message}>
              <Input {...register("title")} {...fieldA11y("d-title", errors.title?.message)} placeholder="e.g. Website redesign" />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Client" htmlFor="d-client">
                <Controller
                  control={control}
                  name="clientId"
                  render={({ field }) => (
                    <SelectField
                      id="d-client"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      noneLabel="A prospect — not a client yet"
                      options={choices.clients.map((c) => ({ value: c.id, label: c.name }))}
                      disabled={Boolean(deal?.project)}
                    />
                  )}
                />
              </FormField>
              {!clientId && (
                <FormField label="Prospect" htmlFor="d-prospect" required error={errors.prospectName?.message}>
                  <Input {...register("prospectName")} {...fieldA11y("d-prospect", errors.prospectName?.message)} placeholder="Company name" />
                </FormField>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <FormField label="Value" htmlFor="d-value" required error={errors.value?.message}>
                <Controller
                  control={control}
                  name="value"
                  render={({ field }) => (
                    <AmountInput value={field.value} onChange={(v) => field.onChange(v ?? undefined)} decimals={currencyDecimals(currency)} {...fieldA11y("d-value", errors.value?.message)} />
                  )}
                />
              </FormField>
              <FormField label="Currency" htmlFor="d-currency">
                <Controller
                  control={control}
                  name="currency"
                  render={({ field }) => <SelectField id="d-currency" value={field.value} onChange={field.onChange} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />}
                />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_120px_1fr]">
              <FormField label="Stage" htmlFor="d-stage">
                <Controller
                  control={control}
                  name="stageId"
                  render={({ field }) => (
                    <SelectField
                      id="d-stage"
                      value={field.value}
                      onChange={(v) => {
                        field.onChange(v);
                        // The stage's default probability, unless it was set by hand.
                        const next = choices.stages.find((s) => s.id === v);
                        if (next && !dirtyFields.probability) setValue("probability", next.probability);
                      }}
                      options={choices.stages.map((s) => ({ value: s.id, label: s.name }))}
                    />
                  )}
                />
              </FormField>
              <FormField label="Probability %" htmlFor="d-prob" error={errors.probability?.message}>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  disabled={stage?.category !== "open"}
                  {...register("probability", { valueAsNumber: true })}
                  {...fieldA11y("d-prob", errors.probability?.message)}
                />
              </FormField>
              <FormField label="Expected close" htmlFor="d-close">
                <Controller control={control} name="expectedClose" render={({ field }) => <DatePicker id="d-close" value={field.value ?? ""} onChange={field.onChange} className="w-full" />} />
              </FormField>
            </div>
            {stage?.category === "lost" && (
              <FormField label="Why it was lost" htmlFor="d-lost" required>
                <Input id="d-lost" {...register("lostReason")} placeholder="e.g. Budget moved to next year" />
              </FormField>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Owner" htmlFor="d-owner">
                <Controller
                  control={control}
                  name="ownerId"
                  render={({ field }) => (
                    <SelectField id="d-owner" value={field.value ?? ""} onChange={field.onChange} noneLabel="No owner" options={choices.people.map((p) => ({ value: p.id, label: p.name }))} />
                  )}
                />
              </FormField>
              <FormField label="Lead source" htmlFor="d-source">
                <Input id="d-source" {...register("leadSource")} placeholder="Referral, Dribbble…" />
              </FormField>
              <FormField label="Service" htmlFor="d-service">
                <Input id="d-service" {...register("serviceType")} placeholder="Website, Branding…" />
              </FormField>
            </div>
            <FormField label="Notes" htmlFor="d-notes">
              <Textarea id="d-notes" rows={3} {...register("notes")} />
            </FormField>
          </fieldset>

          <DialogFooter className="sm:justify-between">
            {deal && choices.canManage && !deal.project ? (
              <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>
                Delete deal
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="tertiary" onClick={onClose}>
                {readOnly ? "Close" : "Cancel"}
              </Button>
              {!readOnly && (
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Saving…" : deal ? "Save" : "Add deal"}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
        {deal && (
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title={`Delete ${deal.title}?`}
            description="Only for a deal entered by mistake — a deal that didn't work out goes to a Lost stage, so it counts in the win rate."
            confirmLabel="Delete deal"
            cancelLabel="Keep it"
            destructive
            onConfirm={async () => {
              const res = await deleteDeal(deal.id);
              if (!res.ok) {
                toast.error(res.error);
                return false;
              }
              toast.success("Deal deleted");
              onClose();
              router.refresh();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Won: the project already exists, or add the client and create it. */
function WonNextStep({ deal, choices, onDone }: { deal: DealView; choices: SalesChoices; onDone: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState(() => suggestCode(deal.prospectName ?? deal.title));
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const client = choices.clients.find((c) => c.id === deal.client?.id);

  if (deal.project) {
    return (
      <div className="bg-surface-3 shadow-surface-2 flex items-center justify-between gap-3 rounded-xl p-3 text-body">
        <span className="flex items-center gap-2">
          <StatusBadge value="won" label="Won" />
          Became project <span className="tabular">{deal.project.code}</span>.
        </span>
        <Link href={`/projects/${deal.project.id}`} className="underline underline-offset-2">
          Open project
        </Link>
      </div>
    );
  }
  if (!choices.canCreateProject) return null;

  return (
    <div className="bg-surface-3 shadow-surface-2 flex flex-col gap-3 rounded-xl p-3 text-body">
      <p className="flex items-center gap-2">
        <StatusBadge value="won" label="Won" />
        {deal.client ? "Next: create the project. Its contract value starts at the deal's value." : `Next: add ${deal.prospectName ?? "the prospect"} as a client, then create the project.`}
      </p>
      {deal.client ? (
        <div>
          <Button type="button" size="sm" onClick={() => setCreating(true)}>
            Create project
          </Button>
        </div>
      ) : choices.canAddClient ? (
        <div className="flex flex-wrap items-end gap-2">
          <FormField label="Client code" htmlFor="d-code" hint="2–6 capital letters; project codes start with it.">
            <Input id="d-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="w-28" maxLength={6} />
          </FormField>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await createClientFromDeal(deal.id, code);
              setBusy(false);
              if (!res.ok) return void toast.error(res.error);
              toast.success(`${deal.prospectName ?? "Client"} added as a client`);
              router.refresh();
              onDone();
            }}
          >
            Add as client
          </Button>
        </div>
      ) : null}
      {creating && client && (
        <ProjectFormDialog
          open
          onOpenChange={(o) => {
            if (!o) {
              setCreating(false);
              onDone();
            }
          }}
          clients={choices.clients}
          pms={choices.pms}
          canEditContract={choices.canEditContract}
          dealId={deal.id}
          defaults={{
            name: deal.title,
            kind: "client",
            clientId: client.id,
            contractType: "fixed",
            currency: deal.currency as (typeof CURRENCIES)[number],
            contractValue: deal.value,
            retainerFeePerMonth: null,
            pmId: choices.defaultPmId,
            status: "active",
            startDate: choices.today,
            endDate: "",
            links: { notion: "", figma: "", drive: "", slack_channel: "" },
            budget: { budgetHours: null, retainerHoursPerMonth: null, rolloverMode: "none", rolloverCapHours: null, alertThresholds: choices.thresholds },
          }}
        />
      )}
    </div>
  );
}
