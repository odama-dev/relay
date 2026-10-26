"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import type { DealView, StageView } from "@/lib/sales/queries";
import type { CrmCompanyOption, CrmPersonOption } from "@/lib/crm/queries";
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, LEAD_TYPES } from "@/lib/sales/pure";
import { currencyDecimals, formatDate, sentenceEnum } from "@/lib/format";
import { CURRENCIES, dealSchema, type DealInput } from "@/lib/validation";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, fieldA11y } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { SearchSelect } from "@/components/search-select";
import { DatePicker } from "@/components/date-picker";
import { AmountInput } from "@/components/amount-input";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { ProjectFormDialog, type ClientChoice, type PmChoice } from "@/app/(app)/projects/project-form-dialog";
import { createClientFromDeal, createDeal, deleteDeal, updateDeal } from "./actions";

type Output = z.output<typeof dealSchema>;

export type SalesChoices = {
  stages: StageView[];
  crmPeople: CrmPersonOption[];
  crmCompanies: CrmCompanyOption[];
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
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<DealInput, unknown, Output>({
    resolver: zodResolver(dealSchema),
    defaultValues: deal
      ? {
          title: deal.title,
          personId: deal.person?.id ?? "",
          companyId: deal.company?.id ?? "",
          leadDate: deal.leadDate,
          lastContactOn: deal.lastContactOn ?? "",
          value: deal.value,
          currency: deal.currency as (typeof CURRENCIES)[number],
          ownerId: deal.owner?.id ?? "",
          leadSource: deal.leadSource,
          leadType: deal.leadType,
          stageId: deal.stageId,
          lastStageId: deal.lastStageId ?? "",
          lostReason: deal.lostReason ?? "",
        }
      : {
          title: "",
          personId: "",
          companyId: "",
          leadDate: choices.today,
          lastContactOn: "",
          value: undefined as unknown as number,
          currency: "IDR",
          ownerId: choices.userId,
          leadSource: null,
          leadType: null,
          stageId: startStage.id,
          lastStageId: "",
          lostReason: "",
        },
  });
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
            <FormField label="Lead name" htmlFor="d-title" required error={errors.title?.message}>
              <Input {...register("title")} {...fieldA11y("d-title", errors.title?.message)} placeholder="e.g. Website redesign for Kopi Senja" />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Associated company" htmlFor="d-company" hint="From Companies. A client's company links the deal to that client.">
                <Controller
                  control={control}
                  name="companyId"
                  render={({ field }) => (
                    <SearchSelect
                      id="d-company"
                      value={field.value}
                      onChange={field.onChange}
                      noneLabel="No company"
                      placeholder="Search companies…"
                      emptyText="No company found. Add it in Companies first."
                      options={choices.crmCompanies.map((c) => ({ value: c.id, label: c.name, hint: c.domain ?? undefined }))}
                      disabled={readOnly || Boolean(deal?.project)}
                    />
                  )}
                />
              </FormField>
              <FormField label="Associated person" htmlFor="d-person" hint="From People, matched by name or email.">
                <Controller
                  control={control}
                  name="personId"
                  render={({ field }) => (
                    <SearchSelect
                      id="d-person"
                      value={field.value}
                      onChange={(v) => {
                        field.onChange(v);
                        // A person at a company brings the company along when none is set.
                        const person = choices.crmPeople.find((p) => p.id === v);
                        if (person?.companyId && !getValues("companyId") && !deal?.project) setValue("companyId", person.companyId);
                      }}
                      noneLabel="No person"
                      placeholder="Search people…"
                      emptyText="No person found. Add them in People first."
                      options={choices.crmPeople.map((p) => ({ value: p.id, label: p.name, hint: p.email ?? undefined }))}
                      disabled={readOnly}
                    />
                  )}
                />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Lead date in" htmlFor="d-lead-date" required error={errors.leadDate?.message}>
                <Controller control={control} name="leadDate" render={({ field }) => <DatePicker id="d-lead-date" value={field.value} onChange={field.onChange} className="w-full" />} />
              </FormField>
              <FormField label="Last contact" htmlFor="d-last-contact">
                <Controller
                  control={control}
                  name="lastContactOn"
                  render={({ field }) => <DatePicker id="d-last-contact" value={field.value ?? ""} onChange={field.onChange} clearable className="w-full" />}
                />
              </FormField>
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
                <Controller
                  control={control}
                  name="leadSource"
                  render={({ field }) => (
                    <SelectField
                      id="d-source"
                      value={field.value ?? ""}
                      onChange={(v) => field.onChange(v || null)}
                      noneLabel="Not set"
                      options={LEAD_SOURCES.map((v) => ({ value: v, label: LEAD_SOURCE_LABELS[v] }))}
                    />
                  )}
                />
              </FormField>
              <FormField label="Lead type" htmlFor="d-type">
                <Controller
                  control={control}
                  name="leadType"
                  render={({ field }) => (
                    <SelectField
                      id="d-type"
                      value={field.value ?? ""}
                      onChange={(v) => field.onChange(v || null)}
                      noneLabel="Not set"
                      options={LEAD_TYPES.map((v) => ({ value: v, label: sentenceEnum(v) }))}
                    />
                  )}
                />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Stage" htmlFor="d-stage">
                <Controller
                  control={control}
                  name="stageId"
                  render={({ field }) => (
                    <SelectField
                      id="d-stage"
                      value={field.value}
                      onChange={field.onChange}
                      options={choices.stages.filter((s) => !s.isHidden || s.id === field.value).map((s) => ({ value: s.id, label: s.name }))}
                    />
                  )}
                />
              </FormField>
              {stage && stage.category !== "open" && (
                <FormField label="Last stage" htmlFor="d-last-stage" hint="The furthest open stage it reached.">
                  <Controller
                    control={control}
                    name="lastStageId"
                    render={({ field }) => (
                      <SelectField
                        id="d-last-stage"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        noneLabel="Not recorded"
                        options={choices.stages.filter((s) => s.category === "open" && (!s.isHidden || s.id === field.value)).map((s) => ({ value: s.id, label: s.name }))}
                      />
                    )}
                  />
                </FormField>
              )}
            </div>
            {stage?.category === "lost" && (
              <FormField label="Lost reason" htmlFor="d-lost">
                <Input id="d-lost" {...register("lostReason")} placeholder="e.g. Budget moved to next year" />
              </FormField>
            )}
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
