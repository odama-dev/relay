"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch, type Control, type UseFormRegister } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { CompanyRow, CrmFormOptions } from "@/lib/crm/queries";
import type { Country } from "@/lib/geo/countries";
import { ARR_RANGES, ARR_RANGE_LABELS, EMPLOYEE_RANGES, EMPLOYEE_RANGE_LABELS, normalizeDomain } from "@/lib/crm/pure";
import { currencyDecimals } from "@/lib/format";
import { CURRENCIES, crmCompanySchema, type CrmCompanyInput } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, fieldA11y } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { DatePicker } from "@/components/date-picker";
import { AmountInput } from "@/components/amount-input";
import { ChipsField, listError } from "@/components/chips-field";
import { RecordForm } from "@/components/record-panel";
import { CountrySelect } from "@/components/country-select";
import { SocialFields, type SocialFieldValues } from "@/components/crm/social-fields";
import { createCompany, updateCompany } from "../crm-actions";

/**
 * Create or edit a company inside the company panel. Name, a domain and the
 * country are required; the team and deals it lists are linked to it on
 * save, and names typed into the team become new people at it. `onSaved` gets its id (a new company's panel opens on it).
 */
export function CompanyForm({
  company,
  options,
  onSaved,
  onCancel,
}: {
  company?: CompanyRow;
  options: CrmFormOptions;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CrmCompanyInput>({
    // Raw values go to the action, which parses (and transforms) them itself.
    resolver: zodResolver(crmCompanySchema, undefined, { raw: true }),
    defaultValues: {
      name: company?.name ?? "",
      domains: company?.domains ?? [],
      description: company?.description ?? "",
      team: company ? options.people.filter((p) => p.companyId === company.id).map((p) => p.id) : [],
      categories: company?.categories ?? [],
      country: (company?.country as Country | null) ?? undefined,
      angellist: company?.angellist ?? "",
      facebook: company?.facebook ?? "",
      instagram: company?.instagram ?? "",
      linkedin: company?.linkedin ?? "",
      twitter: company?.twitter ?? "",
      twitterFollowers: company?.twitterFollowers ?? null,
      estimatedArr: company?.estimatedArr ?? null,
      fundingRaised: company?.fundingRaised ?? null,
      fundingCurrency: (company?.fundingCurrency as (typeof CURRENCIES)[number] | null) ?? "USD",
      foundedOn: company?.foundedOn ?? "",
      employeeRange: company?.employeeRange ?? null,
      dealIds: company ? options.deals.filter((d) => d.companyId === company.id).map((d) => d.id) : [],
    },
  });
  const currency = useWatch({ control, name: "fundingCurrency" }) ?? "USD";

  const onSubmit = handleSubmit(async (values) => {
    if (company) {
      const res = await updateCompany(company.id, values);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Company saved");
      onSaved(company.id);
    } else {
      const res = await createCompany(values);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Company added");
      onSaved(res.data.id);
    }
    router.refresh();
  });

  // A deal with a project keeps its client, so it can't be moved here; one already linked stays listed.
  const linked = new Set(company ? options.deals.filter((d) => d.companyId === company.id).map((d) => d.id) : []);
  const dealOptions = options.deals.filter((d) => !d.locked || linked.has(d.id)).map((d) => ({ value: d.id, label: d.title }));

  return (
    <RecordForm
      icon="clients"
      title={company ? `Edit ${company.name}` : "New company"}
      meta={<span className="truncate">{company ? (company.domain ?? "No domain") : "A prospect or a client. Its people and deals can be linked now or later."}</span>}
      onSubmit={onSubmit}
      footer={
        <>
          <span />
          <div className="flex gap-2">
            <Button type="button" variant="tertiary" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : company ? "Save" : "Add company"}
            </Button>
          </div>
        </>
      }
    >
      <div className="grid gap-4">
        <FormField label="Domains" htmlFor="co-domains" required error={listError(errors.domains)} hint="The first is the primary one. Email from these domains is matched to the company.">
          <Controller
            control={control}
            name="domains"
            render={({ field }) => (
              <ChipsField
                id="co-domains"
                value={field.value ?? []}
                onChange={field.onChange}
                creatable
                normalize={(v) => normalizeDomain(v) ?? v.trim()}
                placeholder="kopisenja.id"
                error={listError(errors.domains)}
              />
            )}
          />
        </FormField>
        <FormField label="Name" htmlFor="co-name" required error={errors.name?.message}>
          <Input {...register("name")} {...fieldA11y("co-name", errors.name?.message)} placeholder="e.g. Kopi Senja" />
        </FormField>
        <FormField label="Description" htmlFor="co-description" error={errors.description?.message}>
          <Textarea {...register("description")} id="co-description" rows={3} placeholder="What they do, and why they matter to us" />
        </FormField>
        <FormField label="Team" htmlFor="co-team" hint="Pick people from People, or type a name to add someone new. Fill in their details on People later.">
          <Controller
            control={control}
            name="team"
            render={({ field }) => (
              <ChipsField
                id="co-team"
                value={field.value ?? []}
                onChange={field.onChange}
                options={options.people.map((p) => ({ value: p.id, label: p.name, hint: p.email ?? undefined }))}
                creatable
                createLabel={(name) => `Create person “${name}”`}
                placeholder="Add or create people"
                emptyText="No one found."
              />
            )}
          />
        </FormField>
        <FormField label="Categories" htmlFor="co-categories">
          <Controller
            control={control}
            name="categories"
            render={({ field }) => (
              <ChipsField
                id="co-categories"
                value={field.value ?? []}
                onChange={field.onChange}
                options={options.categories.map((c) => ({ value: c, label: c }))}
                creatable
                createLabel={(c) => `Create category “${c}”`}
                placeholder="e.g. F&B, SaaS"
                emptyText="No category yet. Type one to create it."
              />
            )}
          />
        </FormField>
        <FormField label="Country" htmlFor="co-country" required error={errors.country?.message} hint="Counted on the country tracker.">
          <Controller control={control} name="country" render={({ field }) => <CountrySelect id="co-country" value={field.value} onChange={field.onChange} />} />
        </FormField>

        <SocialFields
          idPrefix="co"
          register={register as unknown as UseFormRegister<SocialFieldValues>}
          control={control as unknown as Control<SocialFieldValues>}
          errors={errors}
        />

        <FormField label="Estimated ARR" htmlFor="co-arr">
          <Controller
            control={control}
            name="estimatedArr"
            render={({ field }) => (
              <SelectField
                id="co-arr"
                value={field.value ?? ""}
                onChange={(v) => field.onChange(v || null)}
                noneLabel="Not set"
                options={ARR_RANGES.map((v) => ({ value: v, label: ARR_RANGE_LABELS[v] }))}
              />
            )}
          />
        </FormField>
        <div className="grid gap-4 @sm:grid-cols-[1fr_120px]">
          <FormField label="Funding raised" htmlFor="co-funding" error={errors.fundingRaised?.message}>
            <Controller
              control={control}
              name="fundingRaised"
              render={({ field }) => (
                <AmountInput value={field.value} onChange={field.onChange} decimals={currencyDecimals(currency)} {...fieldA11y("co-funding", errors.fundingRaised?.message)} />
              )}
            />
          </FormField>
          <FormField label="Currency" htmlFor="co-currency">
            <Controller
              control={control}
              name="fundingCurrency"
              render={({ field }) => <SelectField id="co-currency" value={field.value ?? "USD"} onChange={field.onChange} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />}
            />
          </FormField>
        </div>
        <div className="grid gap-4 @sm:grid-cols-2">
          <FormField label="Foundation date" htmlFor="co-founded" error={errors.foundedOn?.message}>
            <Controller
              control={control}
              name="foundedOn"
              render={({ field }) => <DatePicker id="co-founded" value={field.value ?? ""} onChange={field.onChange} clearable className="w-full" />}
            />
          </FormField>
          <FormField label="Employee range" htmlFor="co-employees">
            <Controller
              control={control}
              name="employeeRange"
              render={({ field }) => (
                <SelectField
                  id="co-employees"
                  value={field.value ?? ""}
                  onChange={(v) => field.onChange(v || null)}
                  noneLabel="Not set"
                  options={EMPLOYEE_RANGES.map((v) => ({ value: v, label: EMPLOYEE_RANGE_LABELS[v] }))}
                />
              )}
            />
          </FormField>
        </div>
        <FormField label="Associated deals" htmlFor="co-deals" hint="A deal with a project keeps its client, so it isn't listed.">
          <Controller
            control={control}
            name="dealIds"
            render={({ field }) => (
              <ChipsField id="co-deals" value={field.value ?? []} onChange={field.onChange} options={dealOptions} placeholder="Add deals" emptyText="No deal found." />
            )}
          />
        </FormField>
      </div>
    </RecordForm>
  );
}
