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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, fieldA11y } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { SearchSelect } from "@/components/search-select";
import { DatePicker } from "@/components/date-picker";
import { AmountInput } from "@/components/amount-input";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { RecordForm } from "@/components/record-panel";
import { createDeal, createProjectFromDeal, deleteDeal, updateDeal, type WonResult } from "./actions";

type Output = z.output<typeof dealSchema>;

export type SalesChoices = {
  stages: StageView[];
  crmPeople: CrmPersonOption[];
  crmCompanies: CrmCompanyOption[];
  people: { id: string; name: string }[];
  canManage: boolean;
  /** A won deal becomes a client and project as it's saved (lib/sales/won.ts). */
  canCreateProject: boolean;
  canCreateInvoice: boolean;
  today: string;
  userId: string;
};

/**
 * Create or edit a deal (PRD Phase 2 "Pipeline"), inside the deal panel like
 * the record itself. A won deal offers the next step: add the prospect as a
 * client, then create its project with the deal's value as the contract value.
 * `onSaved` gets the deal's id (a new deal's panel opens on it); `onCancel`
 * goes back without saving; `onDeleted` closes the panel.
 */
export function DealForm({
  deal,
  choices,
  initialStageId,
  onSaved,
  onCancel,
  onDeleted,
}: {
  deal?: DealView;
  choices: SalesChoices;
  initialStageId?: string;
  onSaved: (id: string) => void;
  onCancel: () => void;
  onDeleted?: () => void;
}) {
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
    if (deal) {
      const res = await updateDeal(deal.id, values);
      if (!res.ok) return void toast.error(res.error);
      toastWon(res.data, "Deal saved", choices, router.push);
      onSaved(deal.id);
    } else {
      const res = await createDeal(values);
      if (!res.ok) return void toast.error(res.error);
      toastWon(res.data, "Deal added", choices, router.push);
      onSaved(res.data.id);
    }
    router.refresh();
  });

  return (
    <>
      <RecordForm
        icon="target"
        title={deal ? `Edit ${deal.title}` : "New deal"}
        meta={
          <span className="truncate">
            {deal
              ? `In ${choices.stages.find((s) => s.id === deal.stageId)?.name ?? "its stage"} since ${formatDate(deal.stageSince)}`
              : "A lead or opportunity. It becomes a client and a project once it's won."}
          </span>
        }
        onSubmit={onSubmit}
        footer={
          <>
            {deal && choices.canManage && !deal.project ? (
              <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>
                Delete deal
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="tertiary" onClick={onCancel}>
                {readOnly ? "Close" : "Cancel"}
              </Button>
              {!readOnly && (
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Saving…" : deal ? "Save" : "Add deal"}
                </Button>
              )}
            </div>
          </>
        }
      >
        {deal && stage?.category === "won" && <WonNextStep deal={deal} choices={choices} onDone={() => onSaved(deal.id)} />}

        <fieldset disabled={readOnly} className="grid gap-4">
          <FormField label="Lead name" htmlFor="d-title" required error={errors.title?.message}>
            <Input {...register("title")} {...fieldA11y("d-title", errors.title?.message)} placeholder="e.g. Website redesign for Kopi Senja" />
          </FormField>
          <div className="grid gap-4 @sm:grid-cols-2">
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
          <div className="grid gap-4 @sm:grid-cols-2">
            <FormField label="Lead date in" htmlFor="d-lead-date" required error={errors.leadDate?.message}>
              <Controller
                control={control}
                name="leadDate"
                render={({ field }) => <DatePicker id="d-lead-date" value={field.value} onChange={field.onChange} className="w-full" />}
              />
            </FormField>
            <FormField label="Last contact" htmlFor="d-last-contact">
              <Controller
                control={control}
                name="lastContactOn"
                render={({ field }) => <DatePicker id="d-last-contact" value={field.value ?? ""} onChange={field.onChange} clearable className="w-full" />}
              />
            </FormField>
          </div>
          <div className="grid gap-4 @sm:grid-cols-[1fr_120px]">
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
          <div className="grid gap-4 @md:grid-cols-3">
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
          <div className="grid gap-4 @sm:grid-cols-2">
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
      </RecordForm>
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
            (onDeleted ?? onCancel)();
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/** Saved; a deal that just became a project says so, with the way to its first invoice. */
export function toastWon(res: WonResult, saved: string, choices: Pick<SalesChoices, "canCreateInvoice">, push: (href: string) => void) {
  if (!res.project) return void toast.success(saved);
  const { id, code } = res.project;
  toast.success(`Won · project ${code} created`, {
    description: "Its client and project are ready to invoice.",
    action: choices.canCreateInvoice ? { label: "Create invoice", onClick: () => push(`/invoices/new?project=${id}`) } : undefined,
  });
}

/**
 * Won: the project it became, with the way to invoice it. A deal won before
 * won deals made their own project gets the button that makes it now.
 */
export function WonNextStep({ deal, choices, onDone }: { deal: DealView; choices: SalesChoices; onDone: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (deal.project) {
    return (
      <div className="bg-surface-3 shadow-surface-2 flex flex-wrap items-center justify-between gap-3 rounded-xl p-3 text-body">
        <span className="flex items-center gap-2">
          <StatusBadge value="won" label="Won" />
          Became project <span className="tabular">{deal.project.code}</span>.
        </span>
        <span className="flex items-center gap-3">
          <Link href={`/projects/${deal.project.id}`} className="underline underline-offset-2">
            Open project
          </Link>
          {choices.canCreateInvoice && (
            <Link href={`/invoices/new?project=${deal.project.id}`} className="underline underline-offset-2">
              Create invoice
            </Link>
          )}
        </span>
      </div>
    );
  }
  if (!choices.canCreateProject) return null;

  return (
    <div className="bg-surface-3 shadow-surface-2 flex flex-wrap items-center justify-between gap-3 rounded-xl p-3 text-body">
      <span className="flex items-center gap-2">
        <StatusBadge value="won" label="Won" />
        {deal.client ? `Next: the project for ${deal.client.name}.` : `Next: ${deal.prospectName ?? "the prospect"} as a client, with its project.`}
      </span>
      <Button
        type="button"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await createProjectFromDeal(deal.id);
          setBusy(false);
          if (!res.ok) return void toast.error(res.error);
          toastWon(res.data, "Project created", choices, router.push);
          router.refresh();
          onDone();
        }}
      >
        {deal.client ? "Create project" : "Create client & project"}
      </Button>
    </div>
  );
}
